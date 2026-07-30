'use strict';

/*
 * Shared page preparation for the Puppeteer passes.
 *
 * scan-ux.js MEASURES the page after this runs; shoot.js PHOTOGRAPHS it after
 * the exact same preparation. Keeping it in one place is the point: if the two
 * settled differently, the box a finding was measured in would not be the box
 * the screenshot frames.
 *
 *   settle(page, { ignoreSelectors, settleMs })
 *
 * Freezes animations/transitions, hides the ignored chrome (cookie banners,
 * chat widgets), waits for webfonts, scrolls the page once to trigger lazy
 * content and returns to the top, then waits out a short settle delay.
 * Every step is best-effort — a page that refuses one of them still gets
 * scanned/shot.
 */

async function settle(page, opts) {
  const ignoreSelectors = (opts && opts.ignoreSelectors) || [];
  const settleMs = (opts && opts.settleMs) || 600;

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

module.exports = { settle };
