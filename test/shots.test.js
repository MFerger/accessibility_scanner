#!/usr/bin/env node
'use strict';

/*
 * Fixture test for the element-screenshot pass. Serves test/fixtures/, feeds
 * shoot.js a hand-written scan record pointing at known elements, then DECODES
 * each produced WebP in a browser canvas and checks the pixels.
 *
 *   node test/shots.test.js     (or: npm run test:shots)
 *
 * Checking pixels is the point: a crop that silently landed on the wrong part
 * of the page would still be a valid image file. The fixture paints its targets
 * in flat, unique colors, so "the crop is mostly #00c07f and contains the red
 * highlight ring" proves both the clip geometry and the marker are right.
 *
 * Requires python3 (static server) and the project's puppeteer.
 */

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const puppeteer = require('puppeteer');
const { slugify, shotKey } = require('../scripts/lib/util');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');
const PORT = 8138;
const BASE = 'http://127.0.0.1:' + PORT + '/';
const PAGE = BASE + 'shot-target.html';
const DATA = path.join(__dirname, '.shots-data');
const SLUG = slugify(BASE);
const SITE = path.join(DATA, SLUG);
const UX_CONFIG = path.join(__dirname, 'ux.config.test.json');

// Colours to look for, with how far a decoded pixel may drift from them. Flat
// fills survive WebP almost exactly; the highlight is a 3px line, and lossy
// chroma subsampling smears a thin saturated line badly — hence the wide
// tolerance on the ring (it is still unmistakably red to the eye).
const GREEN = { rgb: [0, 192, 127], tol: 24 };    // #target's fill
const BLUE = { rgb: [51, 85, 255], tol: 24 };     // #decoy's fill
const RING = { rgb: [255, 45, 85], tol: 60 };     // the highlight the shooter draws

// Scan records shaped exactly like data/<slug>/latest.json's issues.
const issue = (o) => Object.assign({
  fp: 'fp-' + o.code, type: 'error', message: o.code, selector: '', context: '',
  impact: null, firstSeen: '2026-01-01', isNew: false,
}, o);

const ISSUES = {
  // Found by selector, far below the fold — the crop must still frame it.
  bySelector: issue({ code: 'by-selector', selector: '#target',
    context: '<button id="target" type="button">Target</button>' }),
  // Selector no longer resolves (page changed since the scan): the element has
  // to be recovered from its stored HTML.
  byContext: issue({ code: 'by-context', selector: '#gone-since-the-scan',
    context: '<button id="decoy" type="button">Decoy</button>' }),
  // The three below are unphotographable, and rank last so a capped run is
  // deterministic: it must spend its budget on the two real elements above.
  // Parked off-canvas: nothing to photograph, and no bogus crop of the corner.
  offCanvas: issue({ code: 'off-canvas', type: 'notice', selector: '#offcanvas',
    context: '<a id="offcanvas" href="#main">Skip to content</a>' }),
  // Element is simply gone.
  missing: issue({ code: 'missing', type: 'notice', selector: '#ghost', context: '<div id="ghost">Ghost</div>' }),
  // No element at all (console errors et al) — must not even be attempted.
  noElement: issue({ code: 'no-element', type: 'notice', selector: '', context: '' }),
};

// A page that cannot be reached at all, to prove a page failure is retried and
// then given up on gracefully rather than taking the run down with it.
const DEAD_PAGE = 'http://127.0.0.1:8199/unreachable.html';
const DEAD_ISSUE = issue({ code: 'dead-page', type: 'notice', selector: '#nope',
  context: '<div id="nope">Nope</div>' });

// UX findings are viewport-scoped: this one must be shot at 375px, not 1280.
const UX_ISSUE = issue({ code: 'tapTargets', type: 'warning', viewport: 'mobile',
  selector: '#target', context: '<button id="target" type="button">Target</button>' });

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const res = await fetch(PAGE); if (res.ok) return true; } catch (e) { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('Fixture server did not start on ' + BASE);
}

// Fraction of pixels matching each supplied colour. Decoded in a browser canvas
// because Node has no image decoder of its own.
async function colorFractions(browser, file, colors) {
  const uri = 'data:image/webp;base64,' + fs.readFileSync(file).toString('base64');
  const page = await browser.newPage();
  try {
    return await page.evaluate(async (src, want) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const hits = want.map(() => 0), total = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        for (let k = 0; k < want.length; k++) {
          const c0 = want[k].rgb, t = want[k].tol;
          if (Math.abs(d[i] - c0[0]) <= t && Math.abs(d[i + 1] - c0[1]) <= t &&
              Math.abs(d[i + 2] - c0[2]) <= t) hits[k]++;
        }
      }
      return { w: c.width, h: c.height, fractions: hits.map((n) => n / total) };
    }, uri, colors);
  } finally {
    await page.close().catch(() => {});
  }
}

let failures = 0;
function check(ok, label, detail) {
  if (!ok) failures++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label + (detail ? '\n          ' + detail : ''));
}

(async function () {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(SITE, { recursive: true });
  fs.writeFileSync(path.join(SITE, 'latest.json'), JSON.stringify({
    slug: SLUG, name: '127.0.0.1', url: BASE, scannedAt: new Date().toISOString(), firstScan: true,
    summary: { errors: 5, warnings: 0, notices: 0, total: 5, scanErrors: 0, pages: 1, new: 0, resolved: 0 },
    codes: {}, pages: {
      [PAGE]: Object.keys(ISSUES).map((k) => ISSUES[k]),
      [DEAD_PAGE]: [DEAD_ISSUE],
    },
  }));
  fs.writeFileSync(path.join(SITE, 'ux-latest.json'), JSON.stringify({
    slug: SLUG, name: '127.0.0.1', url: BASE, scannedAt: new Date().toISOString(), firstScan: true,
    viewports: [{ name: 'mobile', width: 375, height: 812 }],
    summary: { errors: 0, warnings: 1, notices: 0, total: 1, scanErrors: 0, pages: 1, new: 0, resolved: 0, byViewport: {} },
    codes: {}, pages: { [PAGE]: [UX_ISSUE] },
  }));

  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: FIXTURES, stdio: 'ignore' });
  let browser;
  try {
    await waitForServer(8000);

    const firstRun = execFileSync('node', ['scripts/shoot.js'], {
      cwd: ROOT, encoding: 'utf8',
      env: Object.assign({}, process.env, {
        DATA_DIR: DATA, SCAN_URL: BASE, UX_CONFIG, SHOT_RETRY_DELAY_MS: '100',
      }),
    });
    process.stdout.write(firstRun);

    console.log('\n=== Screenshot assertions ===');

    // A page that fails is retried before being given up on — sites go briefly
    // busy, and one blip should not cost that page its pictures.
    const retries = (firstRun.match(/retrying in/g) || []).length;
    check(retries === 2, 'an unreachable page is retried (SHOT_RETRIES=2)', 'saw ' + retries + ' retries');
    check(/unreachable\.html/.test(firstRun), 'the failing page is named in the log');
    const manifest = JSON.parse(fs.readFileSync(path.join(SITE, 'shots.json'), 'utf8'));
    const shotsDir = path.join(SITE, 'shots');
    const keyOf = (i) => shotKey(i);

    check(manifest.captured === 3, 'captured 3 shots (2 a11y + 1 ux)',
      'captured=' + manifest.captured + ' missed=' + manifest.missed);
    check(manifest.pageErrors === 1 && manifest.skipped === 1,
      'the dead page is counted as a page error, its element as skipped — not as a missing element',
      'pageErrors=' + manifest.pageErrors + ' skipped=' + manifest.skipped);
    check(manifest.missed === 2,
      'missed counts elements once, not once per attempt', 'missed=' + manifest.missed);
    check(Object.keys(manifest.a11y).length === 2 && Object.keys(manifest.ux).length === 1,
      'shots are filed under the lens they came from',
      'a11y=' + Object.keys(manifest.a11y).length + ' ux=' + Object.keys(manifest.ux).length);

    // Nothing to photograph => no entry, no stray file.
    ['offCanvas', 'missing', 'noElement'].forEach((k) => {
      check(!manifest.a11y[keyOf(ISSUES[k])], 'no shot for "' + ISSUES[k].code + '"');
    });

    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

    // 1. Found by selector, 2200px below the fold: the crop must actually
    //    contain the green button and the highlight ring around it.
    const a = manifest.a11y[keyOf(ISSUES.bySelector)];
    check(!!a, 'element found by selector produced a shot');
    if (a) {
      const r = await colorFractions(browser, path.join(shotsDir, a.f), [GREEN, RING, BLUE]);
      check(r.fractions[0] > 0.05, 'crop is centred on the flagged element',
        (r.fractions[0] * 100).toFixed(1) + '% of pixels are the target colour (' + r.w + '×' + r.h + ')');
      check(r.fractions[1] > 0.001, 'the element is ringed in the report highlight colour',
        (r.fractions[1] * 100).toFixed(2) + '% of pixels are ring red');
      check(r.fractions[2] < 0.02, 'the neighbouring decoy element is not what got framed',
        (r.fractions[2] * 100).toFixed(1) + '% of pixels are decoy blue');
      check(r.w === a.w && r.h === a.h, 'recorded dimensions match the image',
        'manifest ' + a.w + '×' + a.h + ', image ' + r.w + '×' + r.h);
    }

    // 2. Stale selector: recovered from the stored element HTML.
    const b = manifest.a11y[keyOf(ISSUES.byContext)];
    check(!!b, 'element with a stale selector recovered from its stored HTML');
    if (b) {
      const r = await colorFractions(browser, path.join(shotsDir, b.f), [BLUE, GREEN]);
      check(r.fractions[0] > 0.05, 'recovered crop framed the right element',
        (r.fractions[0] * 100).toFixed(1) + '% decoy blue vs ' + (r.fractions[1] * 100).toFixed(1) + '% target green');
    }

    // 3. UX finding shot at its own viewport (375px wide caps the crop).
    const u = manifest.ux[keyOf(UX_ISSUE)];
    check(!!u && u.v === 'mobile', 'ux shot records the viewport it was taken at');
    if (u) {
      check(u.w <= 375, 'ux shot is cropped to the mobile viewport width', 'width=' + u.w);
      const r = await colorFractions(browser, path.join(shotsDir, u.f), [GREEN]);
      check(r.fractions[0] > 0.05, 'ux crop framed the flagged element',
        (r.fractions[0] * 100).toFixed(1) + '% target green');
    }

    // 4. A re-run RESUMES: existing images are reused rather than re-shot, and
    //    images no finding points at any more are pruned.
    const stale = path.join(shotsDir, 'a11y-stalekey.webp');
    fs.writeFileSync(stale, 'not really a webp');
    const rerun = () => JSON.parse(execFileSync('node', ['-e',
      'require("child_process").execFileSync("node",["scripts/shoot.js"],{stdio:"ignore",env:process.env});' +
      'process.stdout.write(require("fs").readFileSync(process.env.MANIFEST,"utf8"))'], {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        DATA_DIR: DATA, SCAN_URL: BASE, UX_CONFIG, MANIFEST: path.join(SITE, 'shots.json'),
      }),
    }).toString());

    const second = rerun();
    check(second.captured === 0 && second.reused === 3,
      'a re-run reuses what is already on disk instead of re-shooting it',
      'captured=' + second.captured + ' reused=' + second.reused);
    check(!fs.existsSync(stale), 'a re-run prunes images no finding points at any more');
    check(fs.readdirSync(shotsDir).filter((f) => /\.webp$/.test(f)).length === 3,
      're-run keeps exactly the current shots');

    // 5. A shot that went missing is the ONLY thing a re-run spends time on —
    //    this is what lets a budget-capped run be finished by running it again.
    const gone = manifest.a11y[keyOf(ISSUES.bySelector)].f;
    fs.unlinkSync(path.join(shotsDir, gone));
    const third = rerun();
    check(third.captured === 1 && third.reused === 2,
      'a re-run fills in only the missing shot', 'captured=' + third.captured + ' reused=' + third.reused);
    check(fs.existsSync(path.join(shotsDir, gone)), 'the missing shot is back on disk');

    // 6. SHOT_REFRESH retakes everything, ignoring what is already there.
    const refreshed = JSON.parse(execFileSync('node', ['-e',
      'require("child_process").execFileSync("node",["scripts/shoot.js"],{stdio:"ignore",env:process.env});' +
      'process.stdout.write(require("fs").readFileSync(process.env.MANIFEST,"utf8"))'], {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        DATA_DIR: DATA, SCAN_URL: BASE, UX_CONFIG, SHOT_REFRESH: '1',
        MANIFEST: path.join(SITE, 'shots.json'),
      }),
    }).toString());
    check(refreshed.captured === 3 && refreshed.reused === 0,
      'SHOT_REFRESH retakes every shot', 'captured=' + refreshed.captured + ' reused=' + refreshed.reused);

    // 7. The cap keeps the worst findings and is honoured (forced fresh, so the
    //    cap is what limits the run rather than reuse).
    execFileSync('node', ['scripts/shoot.js'], {
      cwd: ROOT, stdio: 'ignore',
      env: Object.assign({}, process.env, {
        DATA_DIR: DATA, SCAN_URL: BASE, UX_CONFIG, SHOT_MAX: '1', SHOT_REFRESH: '1',
      }),
    });
    const capped = JSON.parse(fs.readFileSync(path.join(SITE, 'shots.json'), 'utf8'));
    check(capped.captured === 1 && Object.keys(capped.a11y).length === 1,
      'SHOT_MAX caps the run', 'captured=' + capped.captured);
    check(!!capped.a11y[keyOf(ISSUES.bySelector)] || !!capped.a11y[keyOf(ISSUES.byContext)],
      'the cap keeps an error-severity finding, not the warning-severity ux one');
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
    fs.rmSync(DATA, { recursive: true, force: true });
  }

  if (failures) { console.error('\n' + failures + ' screenshot assertion(s) failed.'); process.exit(1); }
  console.log('\nAll screenshot assertions passed.');
})().catch((e) => { console.error('Test run failed: ' + (e && e.stack || e)); process.exit(1); });
