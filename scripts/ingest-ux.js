#!/usr/bin/env node
'use strict';

/*
 * Turn raw scan-ux.js output into a slim, committed UX scan record for one site.
 * The layout-scan counterpart to ingest-results.js — same shape, so the report
 * renders it through the exact same machinery.
 *
 *   ux-results.json  ->  data/<slug>/ux-latest.json   (slim, self-describing)
 *                        data/<slug>/ux-history.json  (one row appended per scan)
 *
 *   SCAN_URL      site URL scanned (required) — gives the slug + landing link
 *   SITE_NAME     friendly name shown in reports          (default: hostname)
 *   UX_RESULTS    raw scan-ux output                       (default: ux-results.json)
 *   DATA_DIR      where committed scan data lives          (default: data)
 *
 * Fingerprints are SCOPE-AWARE (lib/ux-checks.scopeOf): width-specific checks
 * include the viewport (so the same overflow at mobile vs desktop are distinct
 * issues); document-level checks omit it and are de-duped across the per-viewport
 * passes. A scan where every page failed to load must NOT overwrite a good
 * history with a misleading "0 issues", so we bail before writing if so.
 */

const fs = require('fs');
const path = require('path');
const { slugify, hostname, fingerprint, uxFingerprint, truncate, normalizeContext } = require('./lib/util');
const ux = require('./lib/ux-checks');

const RESULTS_FILE = process.env.UX_RESULTS || 'ux-results.json';
const DATA_DIR = process.env.DATA_DIR || 'data';
const INPUT = process.env.SCAN_URL || process.argv[2] || '';
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

const resultPages = (raw && raw.pages) || {};
const pageUrls = Object.keys(resultPages);

// --- broken-scan guard --------------------------------------------------
// A page is a load failure if it produced only page-error entries.
const isLoadFailurePage = (issues) =>
  issues.length > 0 && issues.every((i) => i.code === 'page-error');

if (pageUrls.length === 0) {
  console.error('UX scan produced 0 pages — refusing to overwrite "' + slug + '" UX history (site unreachable?).');
  process.exit(2);
}
const failed = pageUrls.filter((u) => isLoadFailurePage(resultPages[u] || []));
if (failed.length === pageUrls.length) {
  console.error('All ' + pageUrls.length + ' pages failed to load — refusing to overwrite "' + slug + '" UX history.');
  process.exit(2);
}

// --- prior scan (for firstSeen / new / resolved) ------------------------
const siteDir = path.join(DATA_DIR, slug);
const latestPath = path.join(siteDir, 'ux-latest.json');
const historyPath = path.join(siteDir, 'ux-history.json');

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

// --- normalize ----------------------------------------------------------
const codes = {};        // code -> { label, sc, url, tip, severity, method }
const pages = {};        // pageUrl -> [ slim issue ]
const currentFps = new Set();
let errors = 0, warnings = 0, notices = 0, total = 0, scanErrors = 0;
const byViewport = {};

for (const url of pageUrls) {
  const list = Array.isArray(resultPages[url]) ? resultPages[url] : [];
  const out = [];
  const seenDocFp = new Set();   // de-dupe document-scoped checks across viewports

  for (const i of list) {
    if (i.code === 'page-error') { scanErrors++; continue; }

    const meta = ux.forCheck(i.code);
    const scope = meta.scope;
    const ctx = truncate(normalizeContext(i.context), CONTEXT_MAX);
    const vp = scope === 'document' ? 'all' : (i.viewport || 'all');
    const fp = scope === 'document'
      ? fingerprint(url, i.code, i.context, i.selector)
      : uxFingerprint(url, i.viewport || 'all', i.code, i.context, i.selector);

    if (scope === 'document') {
      if (seenDocFp.has(fp)) continue;       // already counted from another viewport pass
      seenDocFp.add(fp);
    } else if (currentFps.has(fp)) {
      continue;                              // identical viewport-scoped finding twice
    }

    const type = meta.severity;
    if (type === 'error') errors++; else if (type === 'warning') warnings++; else notices++;
    total++;
    byViewport[vp] = (byViewport[vp] || 0) + 1;
    currentFps.add(fp);

    if (!codes[i.code]) {
      codes[i.code] = { label: meta.label, sc: meta.sc, url: meta.url, tip: meta.tip, severity: meta.severity, method: meta.method };
    }

    out.push({
      fp, code: i.code, type, viewport: vp,
      message: i.message || meta.label,
      selector: i.selector || '',
      context: ctx,
      firstSeen: priorFirstSeen.get(fp) || RUN_DATE,
    });
  }
  pages[url] = out;
}

let newCount = 0, resolvedCount = 0;
if (priorExisted) {
  for (const fp of currentFps) if (!priorFps.has(fp)) newCount++;
  for (const fp of priorFps) if (!currentFps.has(fp)) resolvedCount++;
}

const summary = {
  errors, warnings, notices, total, scanErrors,
  pages: pageUrls.length, new: newCount, resolved: resolvedCount,
  byViewport,
};

// --- write --------------------------------------------------------------
fs.mkdirSync(siteDir, { recursive: true });
fs.writeFileSync(latestPath, JSON.stringify({
  slug, name, url: INPUT, scannedAt: RUN_ISO, firstScan: !priorExisted,
  viewports: (raw && raw.viewports) || [],
  summary, codes, pages,
}));

let history = [];
try { history = JSON.parse(fs.readFileSync(historyPath, 'utf8')); } catch (e) { /* none yet */ }
if (!Array.isArray(history)) history = [];
const row = { date: RUN_DATE, errors, warnings, notices, total, scanErrors, pages: pageUrls.length, new: newCount, resolved: resolvedCount };
if (history.length && history[history.length - 1].date === RUN_DATE) history[history.length - 1] = row;
else history.push(row);
fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + '\n');

console.log('Ingested UX "' + slug + '": ' + errors + ' errors, ' + warnings + ' warnings, ' + total + ' issues, ' + pageUrls.length + ' pages' +
  (priorExisted ? '  (+' + newCount + ' new, -' + resolvedCount + ' resolved)' : '  (first scan)') +
  ' -> ' + latestPath);
