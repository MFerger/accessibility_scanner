#!/usr/bin/env node
'use strict';

/*
 * Regenerate the whole static site from committed scan data. Reads every
 * data/<slug>/{latest,history,dismissed}.json and renders:
 *
 *   <OUT_DIR>/index.html                  landing page (all sites)
 *   <OUT_DIR>/sites/<slug>/index.html     one report per site
 *   <OUT_DIR>/sites/<slug>/shots/*.webp   element screenshots, copied from data/
 *
 * Runs on every scan so the landing page and every report stay in sync, and
 * nothing a previous run produced is ever lost.
 *
 *   DATA_DIR  committed scan data   (default: data)
 *   OUT_DIR   where to write html   (default: build)
 */

const fs = require('fs');
const path = require('path');
const render = require('./render');

const DATA_DIR = process.env.DATA_DIR || 'data';
const OUT_DIR = process.env.OUT_DIR || 'build';

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

// dismissed.json is { fp: { date, reason } }. Pull out the per-fp reason
// ('false-positive' or, by default, 'resolved'); older files with no reason
// field read as 'resolved' so nothing breaks.
function reasonsFrom(raw) {
  const m = {};
  for (const fp of Object.keys(raw || {})) { const v = raw[fp]; if (v && v.reason) m[fp] = v.reason; }
  return m;
}

// Active counts = scanned totals minus the committed-dismissed issues. Dismissed
// splits into "resolved" (you fixed/accepted it) and "false-positive" (the
// scanner flagged it wrong) by the per-fp reason recorded in dismissed.json.
function activeCounts(latest, dismissedSet, reasonsByFp) {
  let errors = 0, warnings = 0, notices = 0, total = 0, dismissed = 0, falsePositives = 0, resolved = 0;
  for (const url of Object.keys((latest && latest.pages) || {})) {
    for (const it of latest.pages[url]) {
      if (dismissedSet.has(it.fp)) {
        dismissed++;
        if (reasonsByFp && reasonsByFp[it.fp] === 'false-positive') falsePositives++; else resolved++;
        continue;
      }
      total++;
      if (it.type === 'error') errors++;
      else if (it.type === 'warning') warnings++;
      else notices++;
    }
  }
  return { errors, warnings, notices, total, dismissed, falsePositives, resolved };
}

const slugs = fs.existsSync(DATA_DIR)
  ? fs.readdirSync(DATA_DIR).filter((s) => fs.existsSync(path.join(DATA_DIR, s, 'latest.json')))
  : [];

if (slugs.length === 0) {
  console.error('No scan data found in ' + DATA_DIR + '/. Run a scan first (npm run build).');
  process.exit(1);
}

const sites = slugs.map((slug) => {
  const dir = path.join(DATA_DIR, slug);
  const latest = readJson(path.join(dir, 'latest.json'), null);
  const history = readJson(path.join(dir, 'history.json'), []);
  const dismissedRaw = readJson(path.join(dir, 'dismissed.json'), {});
  const dismissedSet = new Set(Object.keys(dismissedRaw));
  const reasonsByFp = reasonsFrom(dismissedRaw);

  // Element screenshots are optional: sites scanned before the shooter existed
  // (or with it turned off) simply render without pictures.
  const shots = readJson(path.join(dir, 'shots.json'), null);

  // UX/layout scan data is optional — a site scanned before the UX scanner
  // existed (or with the UX scan turned off) simply has no second lens.
  const uxLatest = readJson(path.join(dir, 'ux-latest.json'), null);
  let ux = null;
  if (uxLatest && uxLatest.pages) {
    const uxDismissedRaw = readJson(path.join(dir, 'ux-dismissed.json'), {});
    const uxDismissedSet = new Set(Object.keys(uxDismissedRaw));
    const uxReasonsByFp = reasonsFrom(uxDismissedRaw);
    ux = Object.assign({}, uxLatest, {
      history: readJson(path.join(dir, 'ux-history.json'), []),
      dismissedSet: uxDismissedSet,
      reasonsByFp: uxReasonsByFp,
      active: activeCounts(uxLatest, uxDismissedSet, uxReasonsByFp),
      shots: (shots && shots.ux) || null,
    });
  }

  return Object.assign({}, latest, {
    history,
    dismissedSet,
    reasonsByFp,
    active: activeCounts(latest, dismissedSet, reasonsByFp),
    ux,
    shots: (shots && shots.a11y) || null,
  });
});

// Copy the images each report references out of the committed data and next to
// the HTML that points at them (<slug>/shots/<file>). Only what the manifest
// still lists gets copied, so a pruned shot never lingers in a deploy.
function copyShots(site, outDir) {
  const from = path.join(DATA_DIR, site.slug, 'shots');
  const files = new Set();
  for (const m of [site.shots, site.ux && site.ux.shots]) {
    for (const k of Object.keys(m || {})) if (m[k] && m[k].f) files.add(m[k].f);
  }
  if (files.size === 0) return { count: 0, bytes: 0 };
  const dest = path.join(outDir, 'shots');
  fs.mkdirSync(dest, { recursive: true });
  let count = 0, bytes = 0;
  for (const f of files) {
    const src = path.join(from, f);
    try {
      fs.copyFileSync(src, path.join(dest, f));
      bytes += fs.statSync(src).size;
      count++;
    } catch (e) { /* manifest entry with no file — render just shows no picture */ }
  }
  return { count, bytes };
}

// Worst sites first, on the landing page and in our own logging.
sites.sort((a, b) => b.active.errors - a.active.errors || b.active.total - a.active.total);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), render.landing(sites), 'utf8');

let shotCount = 0, shotBytes = 0;
for (const s of sites) {
  const dir = path.join(OUT_DIR, 'sites', s.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), render.site(s), 'utf8');
  const copied = copyShots(s, dir);
  shotCount += copied.count; shotBytes += copied.bytes;
}

const totErrors = sites.reduce((n, s) => n + s.active.errors, 0);
console.log('Built ' + sites.length + ' report(s), ' + totErrors + ' active errors' +
  (shotCount ? ', ' + shotCount + ' screenshot(s) (' + (shotBytes / 1048576).toFixed(1) + ' MB)' : '') +
  ' -> ' + OUT_DIR + '/index.html + ' + OUT_DIR + '/sites/<slug>/index.html');
