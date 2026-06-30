#!/usr/bin/env node
'use strict';

/*
 * Fixture test for the UX/layout scanner. Serves test/fixtures/ with a static
 * server, runs scan-ux.js against it, and asserts each fixture produces (only)
 * the bug it is named for — and that clean.html produces nothing.
 *
 *   node test/run.js     (or: npm run test:ux)
 *
 * Requires python3 (for the static file server) and the project's puppeteer.
 */

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');
const PORT = 8137;
const BASE = 'http://127.0.0.1:' + PORT + '/';
const RUN_CONFIG = path.join(__dirname, 'run-config.test.json');
const UX_CONFIG = path.join(__dirname, 'ux.config.test.json');
const UX_RESULTS = path.join(__dirname, 'ux-results.test.json');

// fixture -> { must: [codes that MUST appear], mustNot: [codes that must NOT] }
const EXPECT = {
  'overflow.html': { must: ['horizontalOverflow'] },
  'broken-img.html': { must: ['brokenImages'] },
  'missing-css.html': { must: ['failedResources'] },
  'no-viewport.html': { must: ['viewportMeta'] },
  'tiny-tap.html': { must: ['tapTargets'] },
  'collapsed.html': { must: ['collapsedContainer'] },
  'clean.html': { must: [], clean: true },
};

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE + 'clean.html');
      if (res.ok) return true;
    } catch (e) { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('Fixture server did not start on ' + BASE);
}

(async function () {
  fs.writeFileSync(RUN_CONFIG, JSON.stringify({
    defaults: {}, urls: Object.keys(EXPECT).map((f) => BASE + f),
  }, null, 2));

  const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
    cwd: FIXTURES, stdio: 'ignore',
  });

  let failures = 0;
  try {
    await waitForServer(8000);

    execFileSync('node', ['scripts/scan-ux.js'], {
      cwd: ROOT, stdio: 'inherit',
      env: Object.assign({}, process.env, {
        RUN_CONFIG: RUN_CONFIG, UX_CONFIG: UX_CONFIG, UX_RESULTS: UX_RESULTS, SCAN_URL: BASE,
      }),
    });

    const out = JSON.parse(fs.readFileSync(UX_RESULTS, 'utf8'));
    console.log('\n=== Fixture assertions ===');
    for (const fixture of Object.keys(EXPECT)) {
      const url = BASE + fixture;
      const issues = out.pages[url] || [];
      const codes = issues.map((i) => i.code);
      const exp = EXPECT[fixture];
      const pageErr = codes.indexOf('page-error') >= 0;
      let ok = true;
      const notes = [];

      if (pageErr) { ok = false; notes.push('page-error: ' + issues.filter((i) => i.code === 'page-error').map((i) => i.message).join('; ')); }
      (exp.must || []).forEach((c) => {
        if (codes.indexOf(c) < 0) { ok = false; notes.push('missing expected "' + c + '"'); }
      });
      if (exp.clean) {
        const noise = codes.filter((c) => c !== 'page-error');
        if (noise.length) { ok = false; notes.push('expected zero issues, got: ' + noise.join(', ')); }
      }

      if (!ok) failures++;
      console.log((ok ? '  PASS  ' : '  FAIL  ') + fixture + '  [' + (codes.join(', ') || 'none') + ']' +
        (notes.length ? '\n          ' + notes.join('\n          ') : ''));
    }
  } finally {
    server.kill('SIGTERM');
    try { fs.unlinkSync(RUN_CONFIG); } catch (e) {}
  }

  if (failures) { console.error('\n' + failures + ' fixture(s) failed.'); process.exit(1); }
  console.log('\nAll fixtures passed.');
})().catch((e) => { console.error('Test run failed: ' + (e && e.stack || e)); process.exit(1); });
