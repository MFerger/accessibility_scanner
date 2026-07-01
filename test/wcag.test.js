#!/usr/bin/env node
'use strict';

/*
 * Unit test for the WCAG lookup tables (scripts/lib/wcag.js).
 *
 *   node test/wcag.test.js     (or: npm run test:wcag)
 *
 * These tables drive every explanation, fix tip, and "why it matters" line in
 * the report, and they degrade SILENTLY when a mapping points at a missing
 * entry (the issue just falls back to generic text). This test makes those
 * dangling references loud instead:
 *
 *   - every axe rule -> SC mapping must resolve to a real WCAG entry
 *   - every SC keyed in FIX must be a real WCAG entry
 *   - a sample htmlcs + axe code must resolve through describe()
 */

const assert = require('assert');
const wcag = require('../scripts/lib/wcag');
const { WCAG, AXE_SC, FIX, CODE_FIX } = wcag;

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };

// 1. Every value in AXE_SC (axe rule id -> SC) must be a key in WCAG.
//    (This caught color-contrast-enhanced -> 1.4.6 pointing at a missing entry.)
for (const rule of Object.keys(AXE_SC)) {
  const sc = AXE_SC[rule];
  ok(WCAG[sc], 'AXE_SC["' + rule + '"] -> ' + sc + ' has no WCAG entry');
}

// 2. Every SC keyed in FIX must be a real WCAG entry (so "locked theme" tips
//    always attach to an explained criterion).
for (const sc of Object.keys(FIX)) {
  ok(WCAG[sc], 'FIX["' + sc + '"] is not a known WCAG SC');
}

// 3. Every WCAG entry must carry the fields the report renders.
for (const sc of Object.keys(WCAG)) {
  const e = WCAG[sc];
  ok(e.name && e.slug && e.tip && e.why, 'WCAG["' + sc + '"] is missing name/slug/tip/why');
}

// 4. CODE_FIX method values are one of the four fix bands.
const METHODS = new Set(['css', 'js', 'markup', 'content']);
for (const code of Object.keys(CODE_FIX)) {
  ok(METHODS.has(CODE_FIX[code].method), 'CODE_FIX["' + code + '"] has an unknown method');
}
for (const sc of Object.keys(FIX)) {
  ok(METHODS.has(FIX[sc].method), 'FIX["' + sc + '"] has an unknown method');
}

// 5. A representative htmlcs code resolves to its SC and a real explanation.
const htmlcs = wcag.describe({
  code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
  runner: 'htmlcs',
});
ok(htmlcs.sc === '1.4.3', 'htmlcs code should resolve to SC 1.4.3, got ' + htmlcs.sc);
ok(/w3\.org/.test(htmlcs.url), 'htmlcs SC should link to a w3.org Understanding page');

// 6. A representative axe code resolves via AXE_SC.
const axe = wcag.describe({ code: 'color-contrast', runner: 'axe', runnerExtras: { impact: 'serious' } });
ok(axe.sc === '1.4.3', 'axe color-contrast should map to SC 1.4.3, got ' + axe.sc);

// 7. The previously-dangling mapping now resolves.
const enhanced = wcag.forSC('1.4.6');
ok(enhanced.name && enhanced.url, '1.4.6 (Contrast Enhanced) must resolve now');

console.log('wcag.test.js: all ' + n + ' assertions passed');
