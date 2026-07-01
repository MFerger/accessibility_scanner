#!/usr/bin/env node
'use strict';

/*
 * Place a dismissed-issues file (downloaded from a report's "Export dismissed"
 * button) into the right committed location, with validation.
 *
 *   node scripts/apply-dismissed.js <slug> <downloaded.json> [--ux]
 *   npm run apply-dismissed -- <slug> <downloaded.json> [--ux]
 *
 * The report's Export button downloads the FULL effective dismissed set as
 * { "<fp>": { "date": "YYYY-MM-DD", "reason": "resolved" | "false-positive" } }.
 * This script validates that shape, writes it to data/<slug>/dismissed.json
 * (or ux-dismissed.json with --ux), and warns about any fingerprints that no
 * longer appear in the latest scan (stale — the element/issue is gone), so you
 * can tell a real dismissal from a leftover. It does not delete stale entries;
 * they're harmless and a re-scan may bring the issue back.
 *
 *   DATA_DIR   where committed scan data lives   (default: data)
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || 'data';

const argv = process.argv.slice(2);
const isUx = argv.includes('--ux');
const positional = argv.filter((a) => !a.startsWith('--'));
const slug = positional[0];
const srcPath = positional[1];

function die(msg) { console.error(msg); process.exit(1); }

if (!slug || !srcPath) {
  die('Usage: node scripts/apply-dismissed.js <slug> <downloaded.json> [--ux]\n' +
      '  <slug>  the site folder under ' + DATA_DIR + '/ (e.g. example-com)\n' +
      '  --ux    apply to the UX lens (ux-dismissed.json) instead of accessibility');
}

const siteDir = path.join(DATA_DIR, slug);
if (!fs.existsSync(siteDir)) {
  const known = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR).join(', ') : '(none)';
  die('No data folder for slug "' + slug + '" at ' + siteDir + '.\nKnown slugs: ' + known);
}

let incoming;
try { incoming = JSON.parse(fs.readFileSync(srcPath, 'utf8')); }
catch (e) { die('Cannot read ' + srcPath + ': ' + e.message); }

// --- validate the shape: { fp: { date, reason } } ------------------------
if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
  die(srcPath + ' is not a dismissed-issues object. Expected { "<fp>": { "date", "reason" } }.');
}
const REASONS = new Set(['resolved', 'false-positive']);
const cleaned = {};
let bad = 0;
for (const fp of Object.keys(incoming)) {
  const v = incoming[fp];
  if (!v || typeof v !== 'object') { console.warn('  ignoring "' + fp + '": value is not an object'); bad++; continue; }
  const reason = REASONS.has(v.reason) ? v.reason : 'resolved';
  const date = typeof v.date === 'string' && v.date ? v.date : new Date().toISOString().slice(0, 10);
  cleaned[fp] = { date, reason };
}
if (Object.keys(cleaned).length === 0) die('No valid dismissed entries found in ' + srcPath + '.');

// --- warn about fingerprints not present in the latest scan --------------
const latestFile = isUx ? 'ux-latest.json' : 'latest.json';
let known = null;
try {
  const latest = JSON.parse(fs.readFileSync(path.join(siteDir, latestFile), 'utf8'));
  known = new Set();
  for (const url of Object.keys((latest && latest.pages) || {})) {
    for (const it of latest.pages[url]) known.add(it.fp);
  }
} catch (e) { /* no latest file for this lens — skip the staleness check */ }

let stale = 0;
if (known) {
  for (const fp of Object.keys(cleaned)) if (!known.has(fp)) stale++;
  if (stale) {
    console.warn('Note: ' + stale + ' of ' + Object.keys(cleaned).length +
      ' dismissed fingerprint(s) are not in the current ' + latestFile +
      ' (issue already gone or from an older scan). Keeping them — harmless.');
  }
} else {
  console.warn('Note: no ' + latestFile + ' found for "' + slug + '" — skipping the staleness check.');
}

// --- write ---------------------------------------------------------------
const outFile = isUx ? 'ux-dismissed.json' : 'dismissed.json';
const outPath = path.join(siteDir, outFile);
fs.writeFileSync(outPath, JSON.stringify(cleaned, null, 2) + '\n');

const n = Object.keys(cleaned).length;
console.log('Wrote ' + n + ' dismissal(s)' + (bad ? ' (' + bad + ' invalid entr' + (bad === 1 ? 'y' : 'ies') + ' skipped)' : '') +
  ' -> ' + outPath + '\nCommit the ' + DATA_DIR + '/ change, then run the "Rebuild report" workflow (or `npm run report`).');
