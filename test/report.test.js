#!/usr/bin/env node
'use strict';

/*
 * Resilience test for the report build (scripts/build-report.js).
 *
 *   node test/report.test.js     (or: npm run test:report)
 *
 * The report build reads one JSON file per site and, until this test existed,
 * a single unreadable one crashed the whole run — every site lost its report
 * because of one bad file. That is not hypothetical: the scan workflow used to
 * swallow a failed `git pull --rebase`, which leaves CONFLICT MARKERS inside
 * data/<slug>/latest.json, and the build step reads those files moments later.
 *
 * Fast and browser-free, so it runs in CI on every push.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-report-test-'));
const DATA = path.join(tmp, 'data');
const OUT = path.join(tmp, 'build');

// A minimal but complete scan record, shaped like ingest-results.js writes it.
function writeSite(slug, extra) {
  const dir = path.join(DATA, slug);
  fs.mkdirSync(dir, { recursive: true });
  const url = 'https://' + slug.replace(/-/g, '.') + '/';
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(Object.assign({
    slug, name: slug, url, scannedAt: '2026-07-31T00:00:00.000Z', firstScan: true,
    summary: { errors: 1, warnings: 0, notices: 0, total: 1, scanErrors: 0, pages: 1, new: 0, resolved: 0 },
    codes: { 'link-name': { sc: '4.1.2', url: null, tip: null, label: 'Links must have discernible text' } },
    pages: {
      [url]: [{
        fp: 'aaa', code: 'link-name', type: 'error', message: 'Links must have discernible text',
        selector: 'a', context: '<a href="/x"></a>', impact: 'serious',
        firstSeen: '2026-07-31', isNew: false, needsReview: false,
      }],
    },
  }, extra || {})));
  return dir;
}

// Returns { ok, out } with BOTH streams — warnings go to stderr, and whether
// the build survived is the exit code, not a thrown exception.
function build() {
  const r = spawnSync('node', ['scripts/build-report.js'], {
    cwd: ROOT, encoding: 'utf8',
    env: Object.assign({}, process.env, { DATA_DIR: DATA, OUT_DIR: OUT }),
  });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}

try {
  // --- 1. A healthy pair of sites builds cleanly. ---------------------------
  writeSite('good-one-com');
  writeSite('good-two-com');
  ok(build().ok, 'a healthy data dir builds cleanly');
  ok(fs.existsSync(path.join(OUT, 'index.html')), 'landing page is written');
  ok(fs.existsSync(path.join(OUT, 'sites', 'good-one-com', 'index.html')), 'per-site report is written');

  // --- 2. The real failure: an aborted rebase leaves conflict markers. ------
  // This is the exact byte pattern git writes into a conflicted file, and the
  // exact crash it used to cause ("Cannot read properties of undefined").
  const broken = path.join(DATA, 'conflicted-com');
  fs.mkdirSync(broken, { recursive: true });
  fs.writeFileSync(path.join(broken, 'latest.json'),
    '<<<<<<< HEAD\n{"slug":"conflicted-com","summary":{"pages":3}}\n=======\n' +
    '{"slug":"conflicted-com","summary":{"pages":4}}\n>>>>>>> 1a2b3c4 (scan)\n');

  const conflicted = build();
  ok(conflicted.ok, 'a conflicted site file must NOT crash the build');
  ok(/skipping "conflicted-com"/.test(conflicted.out), 'the skipped site is named in the output');
  ok(fs.existsSync(path.join(OUT, 'sites', 'good-one-com', 'index.html')),
    'healthy sites still get their reports');
  ok(fs.existsSync(path.join(OUT, 'sites', 'good-two-com', 'index.html')),
    'every healthy site still gets its report');
  ok(!fs.existsSync(path.join(OUT, 'sites', 'conflicted-com', 'index.html')),
    'the unreadable site gets no report');
  const landing = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  ok(!/conflicted-com/.test(landing), 'the unreadable site is absent from the landing page');

  // --- 3. Other ways a write can go wrong. ----------------------------------
  fs.writeFileSync(path.join(broken, 'latest.json'), '');              // truncated to nothing
  ok(build().ok, 'an empty scan file is skipped, not fatal');
  fs.writeFileSync(path.join(broken, 'latest.json'), '{"slug":"x"}');  // valid JSON, wrong shape
  ok(build().ok, 'a JSON file with no summary/pages is skipped, not fatal');

  // --- 4. But an ENTIRELY unreadable data dir must still fail loudly, ------
  //        so a broken scan can never quietly publish an empty report.
  fs.rmSync(path.join(DATA, 'good-one-com'), { recursive: true, force: true });
  fs.rmSync(path.join(DATA, 'good-two-com'), { recursive: true, force: true });
  ok(!build().ok, 'when NO site is readable the build must fail rather than publish nothing');

  console.log('report.test.js: all ' + n + ' assertions passed');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
