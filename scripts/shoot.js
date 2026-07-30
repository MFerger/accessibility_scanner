#!/usr/bin/env node
'use strict';

/*
 * Element screenshots. Re-visits the scanned pages with Puppeteer, finds each
 * flagged element, rings it in red and saves a small cropped WebP so the report
 * can SHOW the issue instead of only describing it.
 *
 *   data/<slug>/latest.json + ux-latest.json   (written by the ingest steps)
 *     -> data/<slug>/shots/<lens>-<key>.webp   (committed alongside the data)
 *        data/<slug>/shots.json                (manifest the report reads)
 *
 * Run it AFTER both ingest steps — it is driven by the normalized findings, not
 * by a fresh scan, so it knows exactly which elements matter and can rank them.
 *
 * ONE SHOT PER ELEMENT, NOT PER OCCURRENCE. Shots are keyed by util.shotKey —
 * the same key the report groups "site-wide" issues by — so a flagged nav link
 * that appears on 40 pages is one picture, not 40. That is what keeps this
 * affordable: a ~50-page site has a few hundred distinct flagged elements, not
 * a few thousand occurrences.
 *
 * Env:
 *   SCAN_URL        site URL scanned (required) — gives the slug
 *   DATA_DIR        committed scan data                    (default: data)
 *   UX_CONFIG       ignore selectors + settle timing       (default: ux.config.json)
 *   SHOT_MAX        cap on shots per site                  (default: 400)
 *   SHOT_QUALITY    WebP quality 1-100                     (default: 70)
 *   SHOT_PAD        px of surrounding context in the crop  (default: 24)
 *   SHOT_MAX_W/H    largest crop, in CSS px                (default: 640 / 400)
 *   SHOT_A11Y_VIEWPORT  viewport for a11y shots            (default: 1280x1024,
 *                   pa11y's default — so the crop matches what pa11y saw)
 *   SHOT_BUDGET_MIN wall-clock budget for the whole pass, in minutes  (default: 6)
 *   SHOT_BUDGET_MS  same budget in milliseconds (SHOT_BUDGET_MIN wins if both set)
 *   SHOT_RETRIES    extra attempts for a page that stalls or fails  (default: 2)
 *   SHOT_RETRY_DELAY_MS  backoff before the first retry, doubled for the second
 *                                                              (default: 3000)
 *   UX_HTTP_USER / UX_HTTP_PASS   HTTP basic auth for staging behind a password
 *
 * Pictures are a bonus, never a reason a scan stalls. A healthy site shoots a
 * few hundred elements in well under a minute, so every wait here is bounded:
 * a wall-clock budget for the pass, a timeout per element, and a page that
 * stops responding is abandoned after a few consecutive timeouts rather than
 * burning the budget one element at a time. Whatever was captured before the
 * budget ran out is kept and reported.
 *
 * Like the ingest steps this refuses to destroy good data: if it captures
 * nothing at all but shots already exist, it leaves them (and the manifest)
 * alone and exits 2 rather than emptying the report's pictures.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const prep = require('./lib/prep');
const { slugify, shotKey } = require('./lib/util');

const DATA_DIR = process.env.DATA_DIR || 'data';
const UX_CONFIG = process.env.UX_CONFIG || 'ux.config.json';
const INPUT = process.env.SCAN_URL || process.argv[2] || '';
const MAX = Math.max(0, parseInt(process.env.SHOT_MAX || '400', 10) || 0);
const QUALITY = Math.min(100, Math.max(1, parseInt(process.env.SHOT_QUALITY || '70', 10) || 70));
const PAD = Math.max(0, parseInt(process.env.SHOT_PAD || '24', 10) || 0);
const MAX_W = Math.max(80, parseInt(process.env.SHOT_MAX_W || '640', 10) || 640);
const MAX_H = Math.max(60, parseInt(process.env.SHOT_MAX_H || '400', 10) || 400);
const MIN_W = 160, MIN_H = 90;            // a 1x1 tap target still gets a usable picture
const BUDGET_MS = process.env.SHOT_BUDGET_MIN
  ? Math.max(0, Math.round(parseFloat(process.env.SHOT_BUDGET_MIN) * 60000) || 0)
  : Math.max(0, parseInt(process.env.SHOT_BUDGET_MS || '360000', 10) || 0);
const ELEMENT_MS = Math.max(100, parseInt(process.env.SHOT_ELEMENT_MS || '8000', 10) || 8000);
const PAGE_MS = 45000;                    // ...nor one page's whole element loop
const DEAD_PAGE_STRIKES = 3;              // consecutive timeouts => the page is wedged
const RETRIES = Math.max(0, parseInt(process.env.SHOT_RETRIES || '2', 10) || 0);
const RETRY_DELAY_MS = Math.max(0, parseInt(process.env.SHOT_RETRY_DELAY_MS || '3000', 10) || 0);

if (!INPUT) {
  console.error('No URL given. Set SCAN_URL or pass a URL argument.');
  process.exit(1);
}

const slug = slugify(INPUT);
const siteDir = path.join(DATA_DIR, slug);
const shotsDir = path.join(siteDir, 'shots');
const manifestPath = path.join(siteDir, 'shots.json');

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

const a11y = readJson(path.join(siteDir, 'latest.json'), null);
if (!a11y || !a11y.pages) {
  console.error('No scan data at ' + path.join(siteDir, 'latest.json') + ' — run the ingest step first.');
  process.exit(1);
}
const ux = readJson(path.join(siteDir, 'ux-latest.json'), null);

const cfg = readJson(UX_CONFIG, {}) || {};
const ignoreSelectors = Array.isArray(cfg.ignoreSelectors) ? cfg.ignoreSelectors : [];
const settleMs = parseInt(cfg.settleMs, 10) || 600;
const navTimeout = parseInt(cfg.navigationTimeoutMs, 10) || 30000;
const concurrency = Math.max(1, parseInt(cfg.concurrency, 10) || 3);
const httpCredentials = (process.env.UX_HTTP_USER && process.env.UX_HTTP_PASS)
  ? { username: process.env.UX_HTTP_USER, password: process.env.UX_HTTP_PASS } : null;

// a11y findings come from pa11y, which uses a 1280x1024 viewport.
const A11Y_VP = (function () {
  const m = /^(\d+)\s*[x×]\s*(\d+)$/.exec(String(process.env.SHOT_A11Y_VIEWPORT || '1280x1024').trim());
  return m ? { width: +m[1], height: +m[2] } : { width: 1280, height: 1024 };
})();

// UX findings are width-specific — photograph each at the viewport it was found
// at, using the dimensions recorded with the scan (falling back to the config).
const uxViewports = {};
for (const v of (ux && ux.viewports) || []) if (v && v.name) uxViewports[v.name] = { width: v.width, height: v.height };
for (const v of cfg.viewports || []) if (v && v.name && !uxViewports[v.name]) uxViewports[v.name] = { width: v.width, height: v.height };

// ---------------------------------------------------------------------------
// Plan: one target per distinct flagged element, ranked so a cap keeps the
// findings that matter most.
// ---------------------------------------------------------------------------

const sevRank = (t) => (t === 'error' ? 0 : t === 'warning' ? 1 : 2);

// Some findings have no element to photograph: console errors and failed
// resources carry no selector at all, and the viewport-meta check points at
// <head>. Everything else — including a broken <img>, whose empty box is
// exactly what you want to see — is fair game.
function shootable(it) {
  const sel = it.selector || '';
  if (!sel && !it.context) return false;
  if (sel === 'head' || sel === 'html > head') return false;
  return true;
}

function planLens(lens, data) {
  const byKey = new Map();
  for (const url of Object.keys((data && data.pages) || {})) {
    for (const it of data.pages[url]) {
      if (!shootable(it)) continue;
      const key = shotKey(it);
      let t = byKey.get(key);
      if (!t) {
        const vpName = (it.viewport && it.viewport !== 'all') ? it.viewport : '';
        const vp = (lens === 'ux' && vpName && uxViewports[vpName]) || A11Y_VP;
        t = {
          key, lens, code: it.code, type: it.type, page: url,
          vpName: lens === 'ux' ? (vpName || 'desktop') : '',
          width: vp.width, height: vp.height,
          selector: it.selector || '', context: it.context || '',
          pages: 0,
        };
        byKey.set(key, t);
      }
      t.pages++;                    // occurrences; drives "photograph this first"
    }
  }
  return [...byKey.values()];
}

const planned = planLens('a11y', a11y).concat(ux ? planLens('ux', ux) : []);
// Errors before warnings before notices; within a severity, the elements that
// hurt the most pages first. Ties broken by key so a re-run picks the same set.
planned.sort((a, b) =>
  sevRank(a.type) - sevRank(b.type) || b.pages - a.pages ||
  (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
const targets = MAX ? planned.slice(0, MAX) : planned;

// Resume, don't restart. An element already on disk (same key => same code on
// the same markup) is carried straight into the new manifest, so a re-run
// spends its whole budget on the pictures that are still MISSING and fills in
// what a previous run ran out of time for. It also means an unchanged site
// re-scans for free: no re-shooting, no rewritten bytes, no git churn.
// SHOT_REFRESH=1 forces every shot to be retaken (use after a redesign that
// changed how things look without changing their markup).
const shots = { a11y: {}, ux: {} };
const REFRESH = /^(1|true|yes)$/i.test(process.env.SHOT_REFRESH || '');
const prior = readJson(manifestPath, null);
let reused = 0;
const todo = targets.filter((t) => {
  if (REFRESH || !prior) return true;
  const prev = prior[t.lens] && prior[t.lens][t.key];
  if (!prev || !prev.f || !fs.existsSync(path.join(shotsDir, prev.f))) return true;
  shots[t.lens][t.key] = prev;
  reused++;
  return false;
});

// Group by the page+viewport each shot needs, so one page load serves all of
// the elements flagged on it.
const groups = new Map();
for (const t of todo) {
  const gk = t.width + 'x' + t.height + '|' + t.page;
  let g = groups.get(gk);
  if (!g) { g = { url: t.page, width: t.width, height: t.height, items: [] }; groups.set(gk, g); }
  g.items.push(t);
}
const groupList = [...groups.values()].sort((a, b) =>
  (a.url < b.url ? -1 : a.url > b.url ? 1 : 0) || a.width - b.width);

// ---------------------------------------------------------------------------
// In-page: find the flagged element, ring it, and hand back the crop rectangle
// in DOCUMENT coordinates (page.screenshot's clip captures beyond the viewport,
// so nothing needs scrolling into view).
// ---------------------------------------------------------------------------

/* eslint-disable */
function locate(opts) {
  var docEl = document.documentElement, body = document.body;
  if (!body) return null;
  var old = document.getElementById('__shotmark');
  if (old) old.remove();                       // never leave a stale ring behind

  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  // Stored context is truncated — pa11y cuts the middle with "...", the ingest
  // step appends "…". Only the leading, untruncated part can be compared.
  function prefixOf(s) {
    var t = norm(s), cut = t.length, a = t.indexOf('...'), b = t.indexOf('…');
    if (a >= 0) cut = Math.min(cut, a);
    if (b >= 0) cut = Math.min(cut, b);
    return t.slice(0, Math.min(cut, 160));
  }
  var want = prefixOf(opts.context);
  function matches(el) { return !!want && norm(el.outerHTML).slice(0, want.length) === want; }
  var wantTag = (want.match(/^<([a-zA-Z0-9-]+)/) || [])[1];

  var el = null, cands = [], i;
  if (opts.selector) {
    try { cands = Array.prototype.slice.call(document.querySelectorAll(opts.selector)); } catch (e) {}
    for (i = 0; i < cands.length; i++) if (matches(cands[i])) { el = cands[i]; break; }
    if (!el && cands.length && !want) el = cands[0];      // nothing better to match on
  }
  if (!el && want) {                           // selector drifted — find it by its HTML
    var scan = document.getElementsByTagName(wantTag || '*');
    for (i = 0; i < scan.length && i < 8000; i++) if (matches(scan[i])) { el = scan[i]; break; }
  }
  // Last resort: the element's markup changed since the scan (a cache-busting
  // query string, a session id, a rotated nonce) so its stored HTML no longer
  // matches. Accept the selector's element only when it is UNAMBIGUOUS — one
  // match, right tag. A wrong picture is worse than no picture.
  if (!el && cands.length === 1 && wantTag && cands[0].nodeName.toLowerCase() === wantTag.toLowerCase()) el = cands[0];
  if (!el) return null;

  var rect = el.getBoundingClientRect();
  var cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden') return null;
  if (rect.width === 0 && rect.height === 0) return null;

  var sx = window.pageXOffset || 0, sy = window.pageYOffset || 0;
  var docW = Math.max(docEl.scrollWidth, body.scrollWidth, docEl.clientWidth);
  var docH = Math.max(docEl.scrollHeight, body.scrollHeight, docEl.clientHeight);
  var absL = rect.left + sx, absT = rect.top + sy;
  // Parked off-canvas (the classic left:-9999px skip link) — there is nothing
  // to see, and a crop clamped back into the page would show the wrong thing.
  if (absL + rect.width < 0 || absT + rect.height < 0 || absL > docW || absT > docH) return null;

  var mark = document.createElement('div');
  mark.id = '__shotmark';
  mark.setAttribute('style', 'position:absolute;margin:0;padding:0;border:0;background:none;' +
    // White inside AND outside the red, so the ring separates from a dark, a
    // light, or a same-hue background (plenty of sites are red).
    'pointer-events:none;z-index:2147483647;border-radius:2px;' +
    'box-shadow:0 0 0 2px rgba(255,255,255,.95),0 0 0 5px #ff2d55,0 0 0 7px rgba(255,255,255,.95);' +
    'left:' + absL + 'px;top:' + absT + 'px;' +
    'width:' + Math.max(rect.width, 2) + 'px;height:' + Math.max(rect.height, 2) + 'px;');
  body.appendChild(mark);
  // position:absolute is document-relative only while <body> is unpositioned.
  // Rather than assume, measure where the ring landed and nudge it onto target.
  var mr = mark.getBoundingClientRect();
  var dx = rect.left - mr.left, dy = rect.top - mr.top;
  if (dx || dy) { mark.style.left = (absL + dx) + 'px'; mark.style.top = (absT + dy) + 'px'; }

  // Crop: the element plus a little context. Small elements sit in the middle
  // of the frame; anything bigger than the frame is anchored at its top-left,
  // so you see where it starts rather than an anonymous slice of its middle.
  var w = Math.min(Math.max(rect.width + opts.pad * 2, opts.minW), opts.maxW, docW);
  var h = Math.min(Math.max(rect.height + opts.pad * 2, opts.minH), opts.maxH, docH);
  var x = (rect.width + opts.pad * 2 > w) ? absL - opts.pad : absL + rect.width / 2 - w / 2;
  var y = (rect.height + opts.pad * 2 > h) ? absT - opts.pad : absT + rect.height / 2 - h / 2;
  x = Math.max(0, Math.min(x, docW - w));
  y = Math.max(0, Math.min(y, docH - h));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}
/* eslint-enable */

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function pool(items, n, worker) {
  let idx = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) await worker(items[idx++]);
  });
  await Promise.all(runners);
}

// Bound any await. The loser of the race is NOT cancelled — a wedged page keeps
// whatever it was doing — so callers also count strikes and abandon the page.
function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(what + ' timed out after ' + ms + 'ms')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

const startedAt = Date.now();
const overBudget = () => BUDGET_MS > 0 && (Date.now() - startedAt) > BUDGET_MS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Per KEY, not per attempt, so a retry can't double-count anything.
const attempted = new Set();
let captured = 0, pageErrors = 0;

// Returns { ok } — ok:false means the PAGE let us down (navigation failed, or
// it stopped answering mid-way), which is worth another try. Running out of a
// budget is not: retrying would just spend the same time again.
async function shootGroup(browser, g, attempt) {
  // A retry only picks up what is still missing — anything already captured on
  // an earlier attempt stays captured.
  const items = g.items.filter((t) => !shots[t.lens][t.key]);
  if (!items.length) return { ok: true };

  let page, got = 0, strikes = 0;
  const t0 = Date.now();
  let loadMs = 0;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: g.width, height: g.height, deviceScaleFactor: 1 });
    if (httpCredentials) await page.authenticate(httpCredentials);

    // Waiting for the full 'load' event costs 15s+ on image-heavy article pages
    // (every ad/embed/tracker has to finish) for no benefit here. Take the DOM
    // as soon as it parses, let settle() scroll the page to trigger lazy images,
    // then give the network a short, bounded chance to quiet down. A page that
    // never goes idle is photographed as-is rather than waited on.
    await page.goto(g.url, { waitUntil: 'domcontentloaded', timeout: navTimeout });
    await withTimeout(prep.settle(page, { ignoreSelectors, settleMs }), navTimeout, 'settle');
    await page.waitForNetworkIdle({ idleTime: 400, timeout: 4000 }).catch(() => {});
    loadMs = Date.now() - t0;

    const tEls = Date.now();
    for (const t of items) {
      if (overBudget() || strikes >= DEAD_PAGE_STRIKES || (Date.now() - tEls) > PAGE_MS) break;
      attempted.add(t.lens + '|' + t.key);
      try {
        const clip = await withTimeout(page.evaluate(locate, {
          selector: t.selector, context: t.context,
          pad: PAD, maxW: MAX_W, maxH: MAX_H, minW: MIN_W, minH: MIN_H,
        }), ELEMENT_MS, 'locate');
        if (!clip) { strikes = 0; continue; }             // element gone, hidden, or off-canvas
        const file = t.lens + '-' + t.key + '.webp';
        const buf = await withTimeout(page.screenshot({
          type: 'webp', quality: QUALITY, captureBeyondViewport: true,
          clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h },
        }), ELEMENT_MS, 'screenshot');
        fs.writeFileSync(path.join(shotsDir, file), buf);
        shots[t.lens][t.key] = { f: file, w: clip.w, h: clip.h, p: t.page, v: t.vpName };
        captured++; got++;
        strikes = 0;                             // only a WHOLE target clears the strikes
      } catch (e) {
        if (/timed out/.test(String(e && e.message))) strikes++;
      }
    }
    const elMs = Date.now() - tEls;
    const stalled = strikes >= DEAD_PAGE_STRIKES;
    console.log('  ' + g.url + ' (' + g.width + 'px) — ' + got + '/' + items.length +
      (attempt ? ' | retry ' + attempt : '') +
      ' | load ' + (loadMs / 1000).toFixed(1) + 's + elements ' + (elMs / 1000).toFixed(1) + 's' +
      (stalled ? '  [page stopped responding]' : '') +
      (elMs > PAGE_MS ? '  [page budget spent]' : '') +
      (overBudget() ? '  [budget spent]' : ''));
    return { ok: !stalled };
  } catch (e) {
    console.log('  ! ' + g.url + ' (' + g.width + 'px)' + (attempt ? ' [retry ' + attempt + ']' : '') +
      ': ' + String((e && e.message) || e));
    return { ok: false };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// A page that stalls or fails to load gets another go on a fresh tab after a
// short backoff — a site being briefly busy shouldn't cost it its pictures.
// Retries stop at the global budget, and never redo an element already taken.
async function shootGroupWithRetries(browser, g) {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt) {
      const wait = RETRY_DELAY_MS * attempt;          // 3s, then 6s
      console.log('  ↻ ' + g.url + ' (' + g.width + 'px) — retrying in ' + (wait / 1000) + 's');
      await sleep(wait);
      if (overBudget()) break;
    }
    const res = await shootGroup(browser, g, attempt);
    if (res.ok) return;
    if (overBudget()) break;
  }
  pageErrors++;   // still not right after every retry
}

(async function () {
  if (targets.length === 0) {
    console.log('No elements to photograph for "' + slug + '".');
    return;
  }
  console.log('Screenshots: ' + targets.length + ' element(s)' +
    (planned.length > targets.length ? ' of ' + planned.length + ' (SHOT_MAX=' + MAX + ')' : '') +
    (reused ? ', ' + reused + ' already captured' : '') +
    ' — ' + todo.length + ' to shoot across ' + groupList.length + ' page load(s).');

  fs.mkdirSync(shotsDir, { recursive: true });
  if (todo.length) {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      // Default is 3 minutes; nothing here legitimately takes that long, and a
      // wedged CDP call should surface as an error, not as a stalled scan.
      protocolTimeout: 60000,
    });
    try {
      await pool(groupList, concurrency, async (g) => {
        if (overBudget()) return;
        await shootGroupWithRetries(browser, g);
      });
    } finally {
      await browser.close().catch(() => {});
    }
  }

  // Refuse to blank out a good set of pictures when the RUN broke (site down,
  // every navigation failing) — the same guard the ingest steps apply to scan
  // data. Loading every page fine and matching no elements is a real result
  // (the site changed), so that case is allowed through.
  if (captured === 0 && reused === 0 && pageErrors > 0 && prior) {
    console.error('Captured 0 of ' + targets.length + ' screenshots after ' + pageErrors +
      ' page load failure(s) — keeping the existing shots for "' + slug + '".');
    process.exit(2);
  }

  // Counted per element, not per attempt: everything we tried and still have no
  // picture for is "missed", everything we never got to is "skipped". A retry
  // that succeeds therefore removes an element from missed rather than adding.
  const missed = attempted.size - captured;
  const skipped = todo.length - attempted.size;

  const manifest = {
    generatedAt: new Date().toISOString(),
    planned: planned.length, captured, reused, missed, skipped, pageErrors, max: MAX,
    a11y: sortKeys(shots.a11y), ux: sortKeys(shots.ux),
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + '\n');

  // Drop images no finding points at any more, so the committed folder tracks
  // the current scan instead of growing forever.
  const keep = new Set(Object.keys(manifest.a11y).map((k) => manifest.a11y[k].f)
    .concat(Object.keys(manifest.ux).map((k) => manifest.ux[k].f)));
  let pruned = 0;
  for (const f of fs.readdirSync(shotsDir)) {
    if (!/\.webp$/.test(f) || keep.has(f)) continue;
    fs.unlinkSync(path.join(shotsDir, f)); pruned++;
  }

  const bytes = [...keep].reduce((n, f) => n + fs.statSync(path.join(shotsDir, f)).size, 0);
  console.log('Captured ' + captured + ' new screenshot(s)' +
    (reused ? ', reused ' + reused : '') + ', ' + missed + ' element(s) not found' +
    (pageErrors ? ', ' + pageErrors + ' page load failure(s)' : '') +
    (skipped ? ', ' + skipped + ' not reached' : '') +
    (pruned ? ', pruned ' + pruned + ' stale' : '') +
    ' — ' + (bytes / 1048576).toFixed(1) + ' MB in ' + shotsDir + '/' +
    ' in ' + ((Date.now() - startedAt) / 1000).toFixed(0) + 's');
  // Say WHY they weren't reached — running out of time and a page that never
  // answered call for completely different responses.
  if (skipped && overBudget()) {
    console.log('Ran out of the ' + (BUDGET_MS / 60000).toFixed(1) + '-minute budget with ' + skipped +
      ' element(s) left. Re-running picks up exactly where this left off (already-captured ' +
      'elements are reused, not re-shot), or raise SHOT_BUDGET_MIN to finish in one pass.');
  } else if (skipped) {
    console.log(skipped + ' element(s) were on ' + pageErrors + ' page(s) that never loaded, after ' +
      RETRIES + ' retr' + (RETRIES === 1 ? 'y' : 'ies') + ' each. Re-running retries just those.');
  }
})().catch((e) => { console.error('Screenshot pass failed: ' + (e && e.stack || e)); process.exit(1); });

// Stable key order keeps the committed manifest's diff to just what changed.
function sortKeys(obj) {
  const out = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k];
  return out;
}
