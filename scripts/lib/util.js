'use strict';

/*
 * Small shared helpers — no dependencies, pure functions.
 */

// FNV-1a (32-bit) -> short base36 string. Used for stable issue fingerprints;
// no crypto dependency and identical output across runs/machines.
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// Collapse runs of whitespace so cosmetic reformatting of an element's HTML
// doesn't change its fingerprint.
function normalizeContext(ctx) {
  return String(ctx == null ? '' : ctx).replace(/\s+/g, ' ').trim();
}

function truncate(str, n) {
  const s = String(str == null ? '' : str);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// Stable id for one issue occurrence.
//
// Deliberately keyed on the element CONTEXT (its outerHTML), NOT the CSS
// selector: pa11y/axe selectors are positional (e.g. "...p:nth-child(6) > a")
// and shift whenever anything above the element changes, which would make a
// dismissed issue reappear on the next scan. Context is stable and meaningful.
// Falls back to the selector only when context is empty (page-level rules such
// as "region" / "heading-order").
//
// Trade-off: two identical elements on a page produce the same fingerprint, so
// dismissing one dismisses both. That's acceptable — same issue, same fix.
function fingerprint(pageUrl, code, context, selector) {
  const basis = normalizeContext(context) || String(selector || '');
  return hash(pageUrl + '|' + code + '|' + basis);
}

// URL-independent fingerprint: the identity of one issue (code) on one element
// (context, else selector) REGARDLESS of which page it sits on. It's fingerprint()
// minus the pageUrl prefix. Occurrences that share this across >= 2 distinct pages
// are one "site-wide" issue — the same rule on the same element (a shared header/
// footer/skip-link), so one fix clears them all. The same rule on a DIFFERENT
// element has different context, so it gets a different key and stays separate.
function globalFingerprint(code, context, selector) {
  const basis = normalizeContext(context) || String(selector || '');
  return hash(code + '|' + basis);
}

// Stable id for one UX/layout issue occurrence. Same as fingerprint() but with
// the viewport folded into the basis, so a width-specific bug (e.g. overflow at
// mobile vs desktop) produces a distinct fingerprint per viewport. Document-level
// UX checks (missing meta, 404s) pass viewport "all" so they collapse to one id
// across the per-viewport passes.
function uxFingerprint(pageUrl, viewport, code, context, selector) {
  const basis = normalizeContext(context) || String(selector || '');
  return hash(pageUrl + '|' + viewport + '|' + code + '|' + basis);
}

// Slug for a site: hostname only, leading "www." dropped, non-alnum -> "-".
// Keeps "www.example.com" and "example.com" from creating two separate sites.
function slugify(input) {
  let host = String(input == null ? '' : input).trim();
  try {
    host = new URL(host.includes('://') ? host : 'https://' + host).hostname;
  } catch (e) { /* not a parseable URL — slugify the raw string */ }
  return host
    .replace(/^www\./i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'site';
}

// Hostname for display (leading "www." kept — it's just a label).
function hostname(input) {
  try {
    return new URL(String(input).includes('://') ? input : 'https://' + input).hostname;
  } catch (e) { return String(input || ''); }
}

module.exports = { hash, normalizeContext, truncate, fingerprint, globalFingerprint, uxFingerprint, slugify, hostname };
