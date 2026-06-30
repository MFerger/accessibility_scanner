#!/usr/bin/env node
'use strict';

/*
 * End-to-end test for the "Site-wide" grouped view + the false-positive flow.
 * Builds the report from committed data, then drives the generated HTML in
 * headless Chrome and asserts the interactive behaviour.
 *
 *   node test/sitewide.test.js     (or: npm run test:sitewide)
 *
 * Requires the project's puppeteer and committed data under data/<slug>/.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) fails++; };

(async () => {
  // Fresh build from committed data (no re-scan — this is the rebuild path).
  execFileSync('node', ['scripts/build-report.js'], { cwd: ROOT, stdio: 'ignore' });
  // Derive the slug from committed data/ (the source of truth) rather than from
  // build/sites/, which may hold stale dirs from a previous multi-site build.
  const dataDir = path.join(ROOT, 'data');
  const slug = fs.readdirSync(dataDir).find((s) => fs.existsSync(path.join(dataDir, s, 'latest.json')));
  const report = slug && path.join(ROOT, 'build', 'sites', slug, 'index.html');
  if (!slug || !fs.existsSync(report)) { console.error('No built report found for committed data.'); process.exit(1); }
  const FILE = 'file://' + report;

  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.goto(FILE, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });

  const L = '#lens-a11y ';
  const num = (sel) => page.$eval(sel, (e) => parseInt(e.textContent, 10) || 0);
  const count = (sel) => page.$$eval(sel, (els) => els.length);
  const membersOf = (gfp) => page.$$eval(L + '.issue', (els, g) => els.filter((e) => e.getAttribute('data-gfp') === g).length, gfp);

  // 1. Grouping: only the same issue on the same element across >= 2 pages.
  const cards = await count(L + '.siteWideBody .swcard');
  ok(cards >= 2, 'Site-wide view is populated (' + cards + ' grouped cards)');
  const firstCard = await page.$(L + '.siteWideBody .swcard');
  ok(await firstCard.$$eval('.pages a', (e) => e.length) >= 2, 'A grouped card spans >= 2 pages');
  ok(await firstCard.$$eval('.sw-el pre', (e) => e.length) <= 1, 'Element preview shown once per card');
  ok(await firstCard.$$eval('.sw-dismiss', (e) => e.length) === 1, 'Card has one Resolve-site-wide checkbox');

  // 2. Single check-off dismisses every member at once.
  const gfp = await firstCard.evaluate((e) => e.getAttribute('data-gfp'));
  const members = await membersOf(gfp);
  const beforeActive = (await num(L + '.cErr')) + (await num(L + '.cWarn')) + (await num(L + '.cNotice'));
  const beforeResolved = await num(L + '.cDismissed');
  await firstCard.$eval('.sw-dismiss', (e) => e.click());
  ok((await count(L + '.issue.is-dismissed')) === members, 'One click dismissed all ' + members + ' member occurrences');
  ok((await num(L + '.cDismissed')) - beforeResolved === members, 'Resolved stat rose by ' + members);
  ok(beforeActive - ((await num(L + '.cErr')) + (await num(L + '.cWarn')) + (await num(L + '.cNotice'))) === members, 'Active counts dropped by ' + members);
  ok((await count(L + '.siteWideBody .swcard')) === cards - 1, 'Resolved group left the Site-wide list');

  // 3. Resolved occurrences hidden by default, revealed by "show resolved".
  ok(await page.$eval(L + '.issue.is-dismissed', (e) => e.offsetParent === null), 'Resolved occurrence hidden by default');
  await page.$eval(L + '.showResolved', (e) => e.click());
  ok(await page.$eval(L + '.issue.is-dismissed', (e) => e.offsetParent !== null), '"show resolved" reveals it');
  await page.$eval(L + '.showResolved', (e) => e.click());

  // 4. False positive: separate status, count, and filter; not counted as resolved.
  const fpCard = await page.$(L + '.siteWideBody .swcard');
  const fpGfp = await fpCard.evaluate((e) => e.getAttribute('data-gfp'));
  const fpMembers = await membersOf(fpGfp);
  const resolvedBeforeFp = await num(L + '.cDismissed');
  await fpCard.$eval('.fp-flag', (e) => e.click());
  ok((await num(L + '.cFalsePos')) === fpMembers, fpMembers + ' occurrences counted as false positives');
  ok((await num(L + '.cDismissed')) === resolvedBeforeFp, 'False positives do not inflate the resolved count');
  ok((await count(L + '.issue.is-fp')) === fpMembers, 'is-fp class applied to all members');
  ok(await page.$eval(L + '.issue.is-fp', (e) => e.offsetParent === null), 'False positive hidden by default');
  await page.$eval(L + '.showFp', (e) => e.click());
  ok(await page.$eval(L + '.issue.is-fp', (e) => e.offsetParent !== null), '"show false positives" reveals it');

  // 5. By-page badge + persisted reasons.
  ok((await count(L + '.byPage .issue.is-sitewide .swbadge')) > 0, 'By-page occurrences carry the site-wide badge');
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), 'a11y-dismiss-' + slug);
  ok(Object.values(stored.reasons || {}).filter((r) => r === 'false-positive').length === fpMembers, 'Reasons persist ' + fpMembers + ' false positives for export');

  await browser.close();
  if (fails) { console.error('\n' + fails + ' check(s) FAILED'); process.exit(1); }
  console.log('\nAll site-wide / false-positive checks passed.');
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
