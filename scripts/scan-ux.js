#!/usr/bin/env node
'use strict';

/*
 * UX / layout scanner. Measures the rendered DOM with Puppeteer (already in the
 * tree via pa11y) at several viewports and records layout / mobile-friendliness
 * bugs — no baseline, no visual diffing, every check is an absolute measurement
 * of the live page.
 *
 *   run-config.json   page URLs (produced by `npm run discover` — run it FIRST)
 *   ux.config.json    viewports, tolerances, ignore selectors, check toggles
 *   -> ux-results.json (transient, gitignored) — consumed by ingest-ux.js
 *
 * Env:
 *   SCAN_URL        site URL scanned (for the report header)            (optional)
 *   RUN_CONFIG      page-URL source                       (default: run-config.json)
 *   UX_CONFIG       check config                          (default: ux.config.json)
 *   UX_RESULTS      output file                           (default: ux-results.json)
 *   UX_HTTP_USER / UX_HTTP_PASS   HTTP basic auth for staging behind a password
 *
 * Crash-proof: every page is wrapped in try/catch and records a `page-error`
 * issue on failure, then the run continues to the next page/viewport.
 */

const fs = require('fs');
const puppeteer = require('puppeteer');

const RUN_CONFIG = process.env.RUN_CONFIG || 'run-config.json';
const UX_CONFIG = process.env.UX_CONFIG || 'ux.config.json';
const OUT = process.env.UX_RESULTS || 'ux-results.json';
const INPUT = process.env.SCAN_URL || process.argv[2] || '';

const RES_TYPES = ['stylesheet', 'script', 'image', 'font'];
// Console noise that just restates a failed resource (covered by failedResources).
const CONSOLE_NOISE = [/Failed to load resource/i, /net::ERR_/i];

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

let runCfg;
try { runCfg = readJson(RUN_CONFIG); }
catch (e) {
  console.error('Cannot read ' + RUN_CONFIG + ' (' + e.message + '). Run `npm run discover` first.');
  process.exit(1);
}
const urls = Array.isArray(runCfg.urls) ? runCfg.urls.filter(Boolean) : [];
if (urls.length === 0) { console.error('No URLs in ' + RUN_CONFIG + '.'); process.exit(1); }

let cfg;
try { cfg = readJson(UX_CONFIG); }
catch (e) { console.error('Cannot read ' + UX_CONFIG + ': ' + e.message); process.exit(1); }

const viewports = (cfg.viewports || []).filter((v) => v && v.enabled !== false);
if (viewports.length === 0) { console.error('No enabled viewports in ' + UX_CONFIG + '.'); process.exit(1); }
const checks = cfg.checks || {};
const concurrency = Math.max(1, parseInt(cfg.concurrency, 10) || 3);
const navTimeout = parseInt(cfg.navigationTimeoutMs, 10) || 30000;
const settleMs = parseInt(cfg.settleMs, 10) || 600;
const ignoreSelectors = Array.isArray(cfg.ignoreSelectors) ? cfg.ignoreSelectors : [];
const ignoreConsole = (cfg.ignoreConsolePatterns || []).map((p) => {
  try { return new RegExp(p, 'i'); } catch (e) { return null; }
}).filter(Boolean).concat(CONSOLE_NOISE);

const httpCredentials = (process.env.UX_HTTP_USER && process.env.UX_HTTP_PASS)
  ? { username: process.env.UX_HTTP_USER, password: process.env.UX_HTTP_PASS } : null;

// ---------------------------------------------------------------------------
// In-page measurement — one self-contained function serialized into the page.
// Returns [{ code, selector, context, message }] for the DOM-measurable checks.
// (failedResources / consoleErrors come from the driver's event listeners.)
// ---------------------------------------------------------------------------

/* eslint-disable */
function measure(opts) {
  var out = [], docEl = document.documentElement, body = document.body;
  if (!body) return out;
  // Compare against clientWidth (EXCLUDES the scrollbar). innerWidth includes it,
  // so a 100vw element would otherwise look ~15px too wide on every site. Use a
  // tolerance of at least the live scrollbar width.
  var refW = docEl.clientWidth;
  var sb = Math.max(0, window.innerWidth - refW);
  var tol = Math.max(opts.tol || 0, sb);

  function cssEsc(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }
  function cssPath(el) {
    var parts = [], n = el, depth = 0;
    while (n && n.nodeType === 1 && depth < 4) {
      if (n.id) { parts.unshift('#' + cssEsc(n.id)); break; }
      var p = n.nodeName.toLowerCase(), par = n.parentNode;
      if (n.classList && n.classList.length)
        p += '.' + Array.prototype.slice.call(n.classList, 0, 2).map(cssEsc).join('.');
      if (par && par.children) {
        var same = Array.prototype.filter.call(par.children, function (c) { return c.nodeName === n.nodeName; });
        if (same.length > 1) p += ':nth-of-type(' + (Array.prototype.indexOf.call(par.children, n) + 1) + ')';
      }
      parts.unshift(p); n = par; depth++;
    }
    return parts.join(' > ');
  }
  function describe(el) {
    var oh = el.outerHTML || '';
    return { selector: cssPath(el), context: oh.length > 400 ? oh.slice(0, 400) : oh };
  }
  function ignored(el) {
    for (var i = 0; i < opts.ignoreSelectors.length; i++) {
      try { if (el.closest(opts.ignoreSelectors[i])) return true; } catch (e) {}
    }
    return false;
  }
  function visible(el) {
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    return !(r.width === 0 && r.height === 0);
  }
  function clippedByAncestor(el) {
    var n = el.parentElement;
    while (n && n !== docEl) {
      var cs = getComputedStyle(n);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') return true;
      n = n.parentElement;
    }
    return false;
  }

  // 1. horizontalOverflow — page wider than the viewport.
  if (opts.checks.horizontalOverflow && docEl.scrollWidth > refW + tol) {
    var nodes = body.getElementsByTagName('*'), over = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i], r = el.getBoundingClientRect();
      if (r.right <= refW + tol && r.left >= -tol) continue;     // within bounds
      if (r.width === 0 && r.height === 0) continue;
      if (ignored(el)) continue;
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (cs.position === 'fixed' || cs.position === 'sticky') continue;
      if (clippedByAncestor(el)) continue;
      over.push({ el: el, amt: Math.round(r.right - refW) });
    }
    var set = over.map(function (o) { return o.el; });
    var culprits = over.filter(function (o) {           // keep boundary culprits only
      var p = o.el.parentElement;
      if (!p || p === docEl || p === body) return true;
      return set.indexOf(p) < 0;                        // parent isn't itself flagged
    });
    culprits.sort(function (a, b) { return b.amt - a.amt; });
    var pageOver = docEl.scrollWidth - refW;
    culprits.slice(0, 5).forEach(function (c) {
      var d = describe(c.el);
      out.push({ code: 'horizontalOverflow', selector: d.selector, context: d.context,
        message: 'Element extends ' + c.amt + 'px past the ' + refW + 'px-wide screen (page is ' + pageOver + 'px too wide).' });
    });
  }

  // 2. brokenImages — <img> that loaded but failed to render.
  if (opts.checks.brokenImages) {
    var imgs = document.images;
    for (var j = 0; j < imgs.length; j++) {
      var im = imgs[j], src = im.currentSrc || im.src;
      if (src && im.complete && im.naturalWidth === 0 && !ignored(im)) {
        var di = describe(im);
        out.push({ code: 'brokenImages', selector: di.selector, context: di.context, src: src,
          message: 'Image failed to load or render: ' + src });
      }
    }
  }

  // 3. viewportMeta — missing / zoom-blocking viewport tag (document-level).
  if (opts.checks.viewportMeta) {
    var mv = document.querySelector('meta[name="viewport"]');
    var c = mv ? (mv.getAttribute('content') || '').toLowerCase() : '';
    if (!mv) {
      out.push({ code: 'viewportMeta', selector: 'head', context: '',
        message: 'No <meta name="viewport"> — the page will not adapt to mobile screens.' });
    } else if (c.indexOf('width=device-width') < 0) {
      out.push({ code: 'viewportMeta', selector: 'head', context: (mv.outerHTML || '').slice(0, 200),
        message: 'Viewport tag does not set width=device-width, so the page will not fit mobile screens: ' + c });
    } else if (/user-scalable\s*=\s*(no|0)/.test(c) || /maximum-scale\s*=\s*(1|1\.0)\b/.test(c)) {
      out.push({ code: 'viewportMeta', selector: 'head', context: (mv.outerHTML || '').slice(0, 200),
        message: 'Viewport tag blocks pinch-to-zoom (bad for low-vision users): ' + c });
    }
  }

  // 4. tapTargets — interactive elements too small (MOBILE only).
  if (opts.checks.tapTargets && opts.isMobile) {
    var min = opts.minTapTargetPx || 24;
    var targets = document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=button],[onclick]');
    Array.prototype.forEach.call(targets, function (el) {
      if (ignored(el) || !visible(el)) return;
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.width < min || r.height < min) {
        var d = describe(el);
        out.push({ code: 'tapTargets', selector: d.selector, context: d.context,
          message: 'Tap target is ' + Math.round(r.width) + '×' + Math.round(r.height) + 'px (aim for at least ' + min + 'px, 44px on mobile).' });
      }
    });
  }

  // 5. smallText — body text too small to read (MOBILE only).
  if (opts.checks.smallText && opts.isMobile) {
    var minF = opts.minFontPx || 12;
    var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null);
    var seen = [], node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      var el = node.parentElement;
      if (!el || ignored(el) || seen.indexOf(el) >= 0) continue;
      if (!visible(el)) continue;
      var fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs && fs < minF) {
        seen.push(el);
        var d = describe(el);
        out.push({ code: 'smallText', selector: d.selector, context: d.context,
          message: 'Text renders at ' + Math.round(fs) + 'px — too small to read comfortably on a phone (aim for 16px).' });
      }
      if (seen.length >= 15) break;
    }
  }

  // 6. elementOverflow — child spilling past an unclipped parent.
  if (opts.checks.elementOverflow) {
    var all = body.getElementsByTagName('*');
    var count = 0;
    for (var k = 0; k < all.length && count < 10; k++) {
      var ch = all[k];
      if (ignored(ch) || !visible(ch)) continue;
      var pcs = ch.parentElement && getComputedStyle(ch.parentElement);
      if (!pcs || pcs.overflowX !== 'visible') continue;
      var ccs = getComputedStyle(ch);
      if (ccs.position === 'absolute' || ccs.position === 'fixed') continue;
      var cr = ch.getBoundingClientRect(), pr = ch.parentElement.getBoundingClientRect();
      if (pr.width === 0) continue;
      if (cr.right > pr.right + 5 || cr.left < pr.left - 5) {
        var d = describe(ch);
        out.push({ code: 'elementOverflow', selector: d.selector, context: d.context,
          message: 'Element extends past its container by ' + Math.round(Math.max(cr.right - pr.right, pr.left - cr.left)) + 'px.' });
        count++;
      }
    }
  }

  // 7. collapsedContainer — has content but renders at zero size.
  if (opts.checks.collapsedContainer) {
    var els = body.getElementsByTagName('*'), cc = 0;
    for (var m = 0; m < els.length && cc < 10; m++) {
      var e2 = els[m];
      if (ignored(e2)) continue;
      var hasContent = e2.children.length > 0 || (e2.textContent && e2.textContent.trim());
      if (!hasContent) continue;
      var cs2 = getComputedStyle(e2);
      if (cs2.display === 'none' || cs2.visibility === 'hidden') continue;
      if (e2.closest('[hidden],[aria-hidden="true"],details:not([open])')) continue;
      // offsetParent !== null means the element is part of the layout (not
      // display:none and not inside a display:none subtree) — so a zero client
      // box here is a genuine collapse, not an intentionally removed element.
      if ((e2.clientHeight === 0 || e2.clientWidth === 0) && e2.offsetParent !== null) {
        var d2 = describe(e2);
        out.push({ code: 'collapsedContainer', selector: d2.selector, context: d2.context,
          message: 'Container holds content but renders with zero ' + (e2.clientHeight === 0 ? 'height' : 'width') + '.' });
        cc++;
      }
    }
  }

  return out;
}
/* eslint-enable */

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function settle(page) {
  await page.addStyleTag({ content:
    '*,*::before,*::after{animation:none!important;transition:none!important;' +
    'scroll-behavior:auto!important;caret-color:transparent!important}' }).catch(() => {});
  if (ignoreSelectors.length) {
    await page.addStyleTag({ content: ignoreSelectors.join(',') + '{display:none!important}' }).catch(() => {});
  }
  await page.evaluate(async () => { try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {} }).catch(() => {});
  await page.evaluate(async () => {                       // trigger lazy content
    await new Promise((res) => {
      var y = 0, h = window.innerHeight || 800, max = 0, t = setInterval(function () {
        max = Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight);
        window.scrollTo(0, y); y += h;
        if (y >= max) { clearInterval(t); window.scrollTo(0, 0); res(); }
      }, 40);
      setTimeout(function () { clearInterval(t); window.scrollTo(0, 0); res(); }, 4000);
    });
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, settleMs));
}

async function scanPageViewport(browser, url, vp) {
  const issues = [];
  const isMobile = vp.width <= 600;
  let page;
  try {
    page = await browser.newPage();
    // NB: deliberately do NOT enable Puppeteer's isMobile emulation. It scales
    // the layout to fit overflowing content, which masks the horizontal-overflow
    // bug we most want to catch at mobile widths. A plain narrow viewport applies
    // width-based media queries identically and reports overflow correctly; the
    // isMobile boolean only gates the touch-target / small-text checks below.
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
    if (httpCredentials) await page.authenticate(httpCredentials);

    // Listeners attached BEFORE navigation so we catch load-time failures.
    const resourceIssues = [];
    const consoleMsgs = [];
    if (checks.failedResources) {
      page.on('response', (res) => {
        try {
          const rt = res.request().resourceType();
          if (RES_TYPES.indexOf(rt) >= 0 && res.status() >= 400) {
            resourceIssues.push({ code: 'failedResources', selector: '', context: '', rt: rt, resUrl: res.url(),
              message: rt + ' returned HTTP ' + res.status() + ': ' + res.url() });
          }
        } catch (e) {}
      });
      page.on('requestfailed', (req) => {
        try {
          const rt = req.resourceType();
          if (RES_TYPES.indexOf(rt) >= 0) {
            const f = req.failure();
            resourceIssues.push({ code: 'failedResources', selector: '', context: '', rt: rt, resUrl: req.url(),
              message: rt + ' request failed (' + (f && f.errorText || 'unknown') + '): ' + req.url() });
          }
        } catch (e) {}
      });
    }
    if (checks.consoleErrors) {
      page.on('console', (msg) => { if (msg.type() === 'error') consoleMsgs.push(msg.text()); });
      page.on('pageerror', (err) => { consoleMsgs.push(String((err && err.message) || err)); });
    }

    await page.goto(url, { waitUntil: 'load', timeout: navTimeout });
    await settle(page);

    const measured = await page.evaluate(measure, {
      tol: cfg.overflowTolerancePx || 0,
      minTapTargetPx: cfg.minTapTargetPx || 24,
      minFontPx: cfg.minFontPx || 12,
      ignoreSelectors: ignoreSelectors,
      isMobile: isMobile,
      checks: checks,
    });
    measured.forEach((m) => issues.push(m));

    // failedResources — drop image 404s already reported as brokenImages.
    const brokenSrcs = {};
    measured.forEach((m) => { if (m.code === 'brokenImages' && m.src) brokenSrcs[m.src] = 1; });
    const seenRes = {};
    resourceIssues.forEach((r) => {
      if (r.rt === 'image' && brokenSrcs[r.resUrl]) return;
      if (seenRes[r.resUrl]) return;
      seenRes[r.resUrl] = 1;
      issues.push({ code: r.code, selector: r.selector, context: r.context, message: r.message });
    });

    // consoleErrors — de-dupe and drop known resource-load noise.
    const seenMsg = {};
    consoleMsgs.forEach((text) => {
      const t = (text || '').trim();
      if (!t || seenMsg[t]) return;
      if (ignoreConsole.some((re) => re.test(t))) return;
      seenMsg[t] = 1;
      issues.push({ code: 'consoleErrors', selector: '', context: '', message: t });
    });
  } catch (e) {
    issues.push({ code: 'page-error', selector: '', context: '', message: String((e && e.message) || e) });
  } finally {
    if (page) await page.close().catch(() => {});
  }
  // strip helper fields before returning
  return issues.map((i) => ({ code: i.code, viewport: vp.name, message: i.message, selector: i.selector || '', context: i.context || '' }));
}

async function pool(items, n, worker) {
  const out = [];
  let idx = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

(async function () {
  const enabledChecks = Object.keys(checks).filter((k) => checks[k]);
  console.log('UX scan: ' + urls.length + ' pages × ' + viewports.length + ' viewport(s) [' +
    viewports.map((v) => v.name).join(', ') + '], checks: ' + enabledChecks.join(', '));

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const pages = {};
  try {
    await pool(urls, concurrency, async (url) => {
      const all = [];
      for (const vp of viewports) {
        const got = await scanPageViewport(browser, url, vp);
        got.forEach((g) => all.push(g));
      }
      pages[url] = all;
      const errs = all.filter((i) => i.code !== 'page-error').length;
      console.log('  ' + url + '  (' + errs + ' findings' +
        (all.some((i) => i.code === 'page-error') ? ', page-error' : '') + ')');
    });
  } finally {
    await browser.close().catch(() => {});
  }

  const result = {
    scannedAt: new Date().toISOString(),
    target: INPUT || (urls[0] || ''),
    viewports: viewports.map((v) => ({ name: v.name, width: v.width, height: v.height })),
    pages: pages,
  };
  fs.writeFileSync(OUT, JSON.stringify(result));
  const total = Object.keys(pages).reduce((n, u) => n + pages[u].filter((i) => i.code !== 'page-error').length, 0);
  console.log('Wrote ' + OUT + ' — ' + total + ' findings across ' + urls.length + ' pages.');
})().catch((e) => { console.error('UX scan failed: ' + (e && e.stack || e)); process.exit(1); });
