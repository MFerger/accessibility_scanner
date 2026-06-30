#!/usr/bin/env node
'use strict';

/*
 * Turn raw pa11y-ci JSON into a slim, committed scan record for one site.
 *
 *   results.json (raw, ~1 MB)  ->  data/<slug>/latest.json   (slim, self-describing)
 *                                  data/<slug>/history.json  (one row appended per scan)
 *
 *   SCAN_URL      site URL scanned (required) — gives the slug + landing link
 *   SITE_NAME     friendly name shown in reports          (default: hostname)
 *   RESULTS_FILE  raw pa11y-ci output                      (default: results.json)
 *   DATA_DIR      where committed scan data lives          (default: data)
 *
 * A failed scan (site down, all pages timing out) must NOT overwrite a good
 * history with a misleading "0 errors", so we bail out before writing if the
 * scan clearly didn't load anything.
 */

const fs = require('fs');
const path = require('path');
const { slugify, hostname, fingerprint, truncate, normalizeContext } = require('./lib/util');
const wcag = require('./lib/wcag');

const RESULTS_FILE = process.env.RESULTS_FILE || 'results.json';
const DATA_DIR = process.env.DATA_DIR || 'data';
const INPUT = process.env.SCAN_URL || process.argv[2] || '';
// Keep the element preview generous so full elements/selectors are usable;
// only guard against pathological cases (e.g. an inline base64 data URI).
const CONTEXT_MAX = Math.max(200, parseInt(process.env.CONTEXT_MAX || '2000', 10) || 2000);

if (!INPUT) {
  console.error('No URL given. Set SCAN_URL or pass a URL argument.');
  process.exit(1);
}

const slug = slugify(INPUT);
const name = process.env.SITE_NAME || hostname(INPUT);

const now = new Date();
const RUN_ISO = now.toISOString();
const RUN_DATE = RUN_ISO.slice(0, 10);

let raw;
try { raw = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8')); }
catch (e) { console.error('Cannot read ' + RESULTS_FILE + ': ' + e.message); process.exit(1); }

const results = (raw && raw.results) || {};
const pageUrls = Object.keys(results);

// --- broken-scan guard ---------------------------------------------------
const LOAD_FAIL = /could not be loaded|net::err|err_|timed out|timeout exceeded|navigation failed/i;
const isLoadFailurePage = (issues) =>
  issues.length > 0 && issues.every((i) => LOAD_FAIL.test(i.message || ''));

if (pageUrls.length === 0) {
  console.error('Scan produced 0 pages — refusing to overwrite "' + slug + '" history (site unreachable?).');
  process.exit(2);
}
const failed = pageUrls.filter((u) => isLoadFailurePage(results[u] || []));
if (failed.length === pageUrls.length) {
  console.error('All ' + pageUrls.length + ' pages failed to load — refusing to overwrite "' + slug + '" history.');
  process.exit(2);
}

// --- prior scan (for firstSeen / new / resolved) -------------------------
const siteDir = path.join(DATA_DIR, slug);
const latestPath = path.join(siteDir, 'latest.json');
const historyPath = path.join(siteDir, 'history.json');

let prior = null;
try { prior = JSON.parse(fs.readFileSync(latestPath, 'utf8')); } catch (e) { /* first scan */ }
const priorExisted = !!(prior && prior.pages);
const priorFps = new Set();
const priorFirstSeen = new Map();
if (priorExisted) {
  for (const u of Object.keys(prior.pages)) {
    for (const it of prior.pages[u]) {
      priorFps.add(it.fp);
      if (it.firstSeen && !priorFirstSeen.has(it.fp)) priorFirstSeen.set(it.fp, it.firstSeen);
    }
  }
}

// --- normalize -----------------------------------------------------------
const codes = {};        // code -> { sc, url, tip, label }  (deduped; pure fn of code)
const pages = {};        // pageUrl -> [ slim issue ]
const currentFps = new Set();
let errors = 0, warnings = 0, notices = 0, total = 0, scanErrors = 0;

for (const url of pageUrls) {
  const raw = Array.isArray(results[url]) ? results[url] : [];
  // Issues with no code are pa11y/puppeteer runner errors (e.g. "Protocol
  // error (Target.closeTarget)..."), not accessibility findings — tally them
  // separately and drop them so they don't masquerade as WCAG errors.
  const issues = raw.filter((i) => { if (!i.code) { scanErrors++; return false; } return true; });
  pages[url] = issues.map((i) => {
    const type = ['error', 'warning', 'notice'].includes(i.type) ? i.type : 'error';
    if (type === 'error') errors++; else if (type === 'warning') warnings++; else notices++;
    total++;

    const message = wcag.cleanMessage(i.message);
    if (!codes[i.code]) {
      const d = wcag.describe(i);
      codes[i.code] = { sc: d.sc, url: d.url, tip: d.tip, label: message };
    }

    const fp = fingerprint(url, i.code, i.context, i.selector);
    currentFps.add(fp);
    return {
      fp,
      code: i.code,
      type,
      message,
      selector: i.selector || '',
      context: truncate(normalizeContext(i.context), CONTEXT_MAX),
      impact: (i.runnerExtras && i.runnerExtras.impact) || null,
      firstSeen: priorFirstSeen.get(fp) || RUN_DATE,
    };
  });
}

let newCount = 0, resolvedCount = 0;
if (priorExisted) {
  for (const fp of currentFps) if (!priorFps.has(fp)) newCount++;
  for (const fp of priorFps) if (!currentFps.has(fp)) resolvedCount++;
}

const summary = {
  errors, warnings, notices, total, scanErrors,
  pages: pageUrls.length, new: newCount, resolved: resolvedCount,
};

// --- write ---------------------------------------------------------------
fs.mkdirSync(siteDir, { recursive: true });
// latest.json is generated data; write compact to keep the committed file small.
fs.writeFileSync(latestPath, JSON.stringify({
  slug, name, url: INPUT, scannedAt: RUN_ISO, firstScan: !priorExisted,
  summary, codes, pages,
}));

let history = [];
try { history = JSON.parse(fs.readFileSync(historyPath, 'utf8')); } catch (e) { /* none yet */ }
if (!Array.isArray(history)) history = [];
const row = { date: RUN_DATE, errors, warnings, notices, total, scanErrors, pages: pageUrls.length, new: newCount, resolved: resolvedCount };
// Replace the row if we already scanned today, otherwise append.
if (history.length && history[history.length - 1].date === RUN_DATE) history[history.length - 1] = row;
else history.push(row);
fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + '\n');

console.log('Ingested "' + slug + '": ' + errors + ' errors, ' + total + ' issues, ' + pageUrls.length + ' pages' +
  (priorExisted ? '  (+' + newCount + ' new, -' + resolvedCount + ' resolved)' : '  (first scan)') +
  ' -> ' + latestPath);
