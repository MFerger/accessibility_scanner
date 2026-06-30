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

const INPUT = process.env.SCAN_URL || process.argv[2] || '';
const OUT = process.env.RUN_CONFIG || 'run-config.json';
const MAX_URLS = Math.max(1, parseInt(process.env.MAX_URLS || '200', 10) || 200);
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
  if (t.endsWith('.xml')) return [t];
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
function sitemapType(url) {
  const base = url.split('/').pop().split('?')[0];
  const m = base.match(/^(.*?)-sitemap\d*\.xml$/i);
  return m ? m[1].toLowerCase() : '';
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'a11y-scanner/1.0' } });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  return res.text();
}

async function collect(url) {
  const xml = await fetchText(url);
  const found = locs(xml);

  if (/<sitemapindex[\s>]/i.test(xml)) {
    let children = found.filter((u) => ALLOWED.has(sitemapType(u)));
    if (children.length > 0) {
      found.filter((u) => !ALLOWED.has(sitemapType(u)))
        .forEach((u) => console.log('  skip ' + u + '  (' + (sitemapType(u) || 'unknown') + ')'));
    } else {
      // Not Yoast-style naming — include every child sitemap rather than bail.
      console.log('  (no Yoast type match; following all ' + found.length + ' child sitemaps)');
      children = found;
    }
    const pages = [];
    for (const child of children) {
      const t = sitemapType(child);
      console.log('  scan ' + child + (t ? '  (' + t + ')' : ''));
      try {
        locs(await fetchText(child)).forEach((u) => pages.push(u));
      } catch (e) {
        console.error('  error reading ' + child + ': ' + e.message);
      }
    }
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

(async function () {
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
