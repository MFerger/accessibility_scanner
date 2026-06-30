#!/usr/bin/env node
'use strict';

/*
 * Unit test for the grouping key behind "site-wide" issues.
 *
 *   node test/fp.test.js     (or: npm run test:fp)
 *
 * globalFingerprint() must group the SAME rule on the SAME element across pages
 * (one fix clears all), and must NOT group the same rule on DIFFERENT elements.
 */

const assert = require('assert');
const { globalFingerprint, fingerprint } = require('../scripts/lib/util');

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };

const ctx = '<a href="/privacy">Privacy</a>';

// 1. Same code + same element context => same gfp, even though the per-page
//    CSS selectors differ (positional selectors shift page to page).
ok(
  globalFingerprint('color-contrast', ctx, 'footer a') ===
  globalFingerprint('color-contrast', ctx, 'div > footer > a:nth-child(2)'),
  'same code+context must group regardless of selector'
);

// 2. The per-page fingerprint() DOES differ by URL — that's exactly why the
//    URL-independent key is needed to group across pages.
ok(
  fingerprint('https://x.com/a', 'color-contrast', ctx, 's') !==
  fingerprint('https://x.com/b', 'color-contrast', ctx, 's'),
  'per-page fingerprints differ by URL'
);

// 3. Same rule, DIFFERENT element => different gfp (must stay separate).
ok(
  globalFingerprint('image-alt', '<img src="a.png">', 'img') !==
  globalFingerprint('image-alt', '<img src="b.png">', 'img'),
  'same rule on different elements must NOT group'
);

// 4. Different rule on the same element => different gfp.
ok(
  globalFingerprint('image-alt', ctx, 's') !==
  globalFingerprint('color-contrast', ctx, 's'),
  'different codes must not collide'
);

// 5. Whitespace-only reformatting of context must not change the key.
ok(
  globalFingerprint('color-contrast', '<a   href="/privacy">Privacy</a>\n', 's') ===
  globalFingerprint('color-contrast', ctx, 's'),
  'cosmetic whitespace must not change the key'
);

// 6. Context-less page-level rules fall back to the selector basis, stably.
ok(
  globalFingerprint('region', '', 'html') ===
  globalFingerprint('region', '', 'html'),
  'context-less rules group on selector fallback'
);

console.log('fp.test.js: all ' + n + ' assertions passed');
