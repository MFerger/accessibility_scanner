#!/usr/bin/env node
'use strict';

/*
 * Expands a sitemap into a flat list of page URLs and writes a pa11y-ci config
 * (run-config.json). Pa11y CI does not follow sitemap indexes itself, so we do
 * it here.
 *
 * Yoast sites: we follow only the child sitemaps whose type is allowed (posts
 * and pages by default), which skips tag/category/author archives cleanly. For
 * non-Yoast indexes (e.g. WordPress core's wp-sitemap.xml) whose children don't
 * use Yoast's "<type>-sitemap.xml" naming, we fall back to including every
 * child sitemap.
 *
 *   SCAN_URL       site base URL (we try several sitemap paths) or a full sitemap URL
 *   SITEMAP_TYPES  comma-separated Yoast types to include   (default: post,page)
 *   MAX_URLS       safety cap on pages scanned              (default: 200)
 *   RUN_CONFIG     output config path                       (default: run-config.json)
 */

const fs = require('fs');
const zlib = require('zlib');

const INPUT = process.env.SCAN_URL || process.argv[2] || '';
const OUT = process.env.RUN_CONFIG || 'run-config.json';
const MAX_URLS = Math.max(1, parseInt(process.env.MAX_URLS || '200', 10) || 200);
// Per-request timeout and how many child sitemaps to fetch at once. A hung
// sitemap host should fail fast rather than stall the whole scan job.
const FETCH_TIMEOUT_MS = Math.max(1000, parseInt(process.env.SITEMAP_TIMEOUT_MS || '20000', 10) || 20000);
const FETCH_CONCURRENCY = Math.max(1, parseInt(process.env.SITEMAP_CONCURRENCY || '5', 10) || 5);
// Guard against a pathological or cyclic sitemap-index chain.
const MAX_SITEMAP_DEPTH = 5;
const ALLOWED = new Set(
  (process.env.SITEMAP_TYPES || 'post,page')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
);

if (!INPUT) {
  console.error('No URL given. Set SCAN_URL or pass a URL argument.');
  process.exit(1);
}

// Sitemap locations to try, in order, when given a site URL (not a full .xml).
function candidates(input) {
  const t = input.trim().replace(/\/+$/, '');
  if (/\.xml(\.gz)?$/i.test(t)) return [t];
  return [t + '/sitemap_index.xml', t + '/wp-sitemap.xml', t + '/sitemap.xml'];
}

function locs(xml) {
  const out = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1].replace(/&amp;/g, '&').trim());
  return out;
}

// Yoast child sitemaps are named <type>-sitemap.xml or <type>-sitemap2.xml
// (optionally gzipped as .xml.gz).
function sitemapType(url) {
  const base = url.split('/').pop().split('?')[0];
  const m = base.match(/^(.*?)-sitemap\d*\.xml(\.gz)?$/i);
  return m ? m[1].toLowerCase() : '';
}

// Fetch a sitemap body, transparently gunzipping .xml.gz sitemaps. We decide by
// the gzip magic bytes (0x1f 0x8b) rather than the header, because fetch()
// already decodes Content-Encoding: gzip — the magic bytes only remain when the
// body is *itself* a gzip file, which is exactly the .xml.gz case.
async function fetchBuffer(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'a11y-scanner/1.0' }, signal: ac.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) return zlib.gunzipSync(buf);
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

// One retry, so a transient network blip or a single timeout doesn't drop a
// whole child sitemap.
async function fetchText(url) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return (await fetchBuffer(url)).toString('utf8'); }
    catch (e) { lastErr = e; if (e && e.name === 'AbortError') lastErr = new Error('timed out after ' + FETCH_TIMEOUT_MS + 'ms for ' + url); }
  }
  throw lastErr;
}

// Fetch items with a bounded concurrency pool, preserving input order in the
// output so the final URL list stays deterministic across runs.
async function mapPool(items, n, worker) {
  const out = [];
  let idx = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) { const i = idx++; out[i] = await worker(items[i], i); }
  });
  await Promise.all(runners);
  return out;
}

// Recursively expand a sitemap (or sitemap index) into a flat list of page URLs.
// Handles nested indexes (index -> index -> urlset); `seen` breaks cycles and
// `depth` caps pathological chains.
async function collect(url, seen, depth) {
  seen = seen || new Set();
  depth = depth || 0;
  if (seen.has(url)) return [];
  seen.add(url);

  const xml = await fetchText(url);
  const found = locs(xml);

  if (/<sitemapindex[\s>]/i.test(xml)) {
    if (depth >= MAX_SITEMAP_DEPTH) {
      console.log('  (max sitemap depth ' + MAX_SITEMAP_DEPTH + ' reached at ' + url + ' — not descending further)');
      return [];
    }
    let children = found.filter((u) => ALLOWED.has(sitemapType(u)));
    if (children.length > 0) {
      found.filter((u) => !ALLOWED.has(sitemapType(u)))
        .forEach((u) => console.log('  skip ' + u + '  (' + (sitemapType(u) || 'unknown') + ')'));
    } else {
      // Not Yoast-style naming (or a nested index whose children are themselves
      // indexes) — follow every child rather than bail.
      console.log('  (no Yoast type match; following all ' + found.length + ' child sitemaps)');
      children = found;
    }
    const results = await mapPool(children, FETCH_CONCURRENCY, async (child) => {
      const t = sitemapType(child);
      console.log('  scan ' + child + (t ? '  (' + t + ')' : ''));
      try {
        return await collect(child, seen, depth + 1);
      } catch (e) {
        console.error('  error reading ' + child + ': ' + e.message);
        return [];
      }
    });
    const pages = [];
    results.forEach((arr) => (arr || []).forEach((u) => pages.push(u)));
    return pages;
  }

  return found; // already a flat urlset
}

function defaults() {
  try {
    const cfg = JSON.parse(fs.readFileSync('.pa11yci', 'utf8'));
    if (cfg && cfg.defaults) return cfg.defaults;
  } catch (e) { /* use fallback below */ }
  return {
    standard: 'WCAG2AA',
    runners: ['axe', 'htmlcs'],
    includeWarnings: true,
    concurrency: 2,
    timeout: 60000,
    chromeLaunchConfig: { args: ['--no-sandbox', '--disable-dev-shm-usage'] }
  };
}

const SINGLE = /^(1|true|yes)$/i.test(process.env.SINGLE || '');

(async function () {
  // Single-page mode: scan just this one URL, skip sitemap discovery entirely.
  // Handy for re-checking one page ("is this fixed now?"). The result is
  // ingested into the same data/<slug>/ record as a full scan, so it only
  // refreshes that one page's issues — it is NOT a full re-scan of the site.
  if (SINGLE) {
    const url = INPUT.trim();
    fs.writeFileSync(OUT, JSON.stringify({ defaults: defaults(), urls: [url] }, null, 2));
    console.log('Single-page mode: ' + url + ' -> ' + OUT);
    return;
  }

  console.log('Including types: ' + [...ALLOWED].join(', '));
  const tried = candidates(INPUT);
  let urls = [];
  let used = '';

  for (const start of tried) {
    console.log('Reading sitemap: ' + start);
    try {
      const found = await collect(start);
      if (found.length > 0) { urls = found; used = start; break; }
      console.log('  (no page URLs here, trying next)');
    } catch (e) {
      console.log('  ' + e.message + ' — trying next');
    }
  }

  urls = Array.from(new Set(urls)).filter(Boolean);
  if (urls.length === 0) {
    console.error('No page URLs found. Tried: ' + tried.join(', '));
    process.exit(1);
  }

  if (urls.length > MAX_URLS) {
    console.log('Capping ' + urls.length + ' URLs to MAX_URLS=' + MAX_URLS +
      ' (raise MAX_URLS to scan more).');
    urls = urls.slice(0, MAX_URLS);
  }

  fs.writeFileSync(OUT, JSON.stringify({ defaults: defaults(), urls: urls }, null, 2));
  console.log('Found ' + urls.length + ' pages via ' + used + ' -> ' + OUT);
})();
