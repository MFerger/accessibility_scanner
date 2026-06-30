#!/usr/bin/env node
'use strict';

/*
 * Regenerate the whole static site from committed scan data. Reads every
 * data/<slug>/{latest,history,dismissed}.json and renders:
 *
 *   <OUT_DIR>/index.html                  landing page (all sites)
 *   <OUT_DIR>/sites/<slug>/index.html     one report per site
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
  const dismissed = readJson(path.join(dir, 'dismissed.json'), {});
  const dismissedSet = new Set(Object.keys(dismissed));

  // Active counts = scanned totals minus the committed-dismissed issues.
  let errors = 0, warnings = 0, notices = 0, total = 0, dCount = 0;
  for (const url of Object.keys(latest.pages || {})) {
    for (const it of latest.pages[url]) {
      if (dismissedSet.has(it.fp)) { dCount++; continue; }
      total++;
      if (it.type === 'error') errors++;
      else if (it.type === 'warning') warnings++;
      else notices++;
    }
  }

  return Object.assign({}, latest, {
    history,
    dismissedSet,
    active: { errors, warnings, notices, total, dismissed: dCount },
  });
});

// Worst sites first, on the landing page and in our own logging.
sites.sort((a, b) => b.active.errors - a.active.errors || b.active.total - a.active.total);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), render.landing(sites), 'utf8');

for (const s of sites) {
  const dir = path.join(OUT_DIR, 'sites', s.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), render.site(s), 'utf8');
}

const totErrors = sites.reduce((n, s) => n + s.active.errors, 0);
console.log('Built ' + sites.length + ' report(s), ' + totErrors + ' active errors -> ' +
  OUT_DIR + '/index.html + ' + OUT_DIR + '/sites/<slug>/index.html');
