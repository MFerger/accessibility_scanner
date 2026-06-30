'use strict';

/*
 * Metadata for the UX / layout checks, the layout-scan counterpart to wcag.js.
 *
 *   forCheck(id) -> { label, sc, url, tip, why, method, lockedTip, severity, scope }
 *   severityOf(id) -> 'error' | 'warning' | 'notice'
 *   scopeOf(id)    -> 'viewport' | 'document'
 *
 * As with wcag.js, the report re-derives all of this at RENDER time, so editing
 * a tip/why/method here and re-running the report (or Rebuild report in CI)
 * updates every report with no re-scan.
 *
 * Fields:
 *   severity  default severity (overridable per-check in ux.config.json)
 *   scope     'viewport' -> a width-specific finding; its fingerprint includes
 *             the viewport, so the same bug at mobile vs desktop are two issues.
 *             'document' -> not width-specific (missing meta, 404s, console
 *             errors); de-duped across viewports and stored as viewport "all".
 *   method    how it's realistically fixed (drives "locked theme" banding):
 *             css/js = "fixable by you"; markup/content = "needs access".
 *   lockedTip the CSS/jQuery how-to (or where-to-go) for locked-theme mode.
 */

const WHY_FALLBACK =
  'This is a rendering or layout problem that makes the page look broken or behave ' +
  'unexpectedly for visitors. Fixing it keeps the site looking professional and usable.';

const CHECKS = {
  horizontalOverflow: {
    label: 'Page scrolls sideways on this screen size',
    severity: 'error', scope: 'viewport', method: 'css',
    sc: '1.4.10', url: 'https://www.w3.org/WAI/WCAG22/Understanding/reflow.html',
    why: 'Something on the page is wider than the screen, so visitors — especially on phones — have to scroll left and right to read every line, and content runs off the edge. It makes the site feel broken and is one of the most common mobile problems.',
    tip: 'Find the element that is wider than the screen and constrain it: max-width:100%, remove fixed pixel widths, let flex/grid wrap, and add overflow-wrap:break-word to long unbroken text/URLs.',
    lockedTip: 'In Additional CSS, target the selector shown on each occurrence and cap it: e.g. .offender{max-width:100%;overflow-wrap:break-word}. Replace any fixed px width with % or clamp(), and check for an element set to 100vw (use 100% instead to avoid the scrollbar).',
  },
  failedResources: {
    label: 'A CSS, script, font, or image file failed to load',
    severity: 'error', scope: 'document', method: 'markup',
    sc: null, url: null,
    why: 'A file the page depends on returned an error or could not be fetched. A missing stylesheet or script can leave the page unstyled or broken; a missing font or image leaves a gap. These are clear, high-confidence faults.',
    tip: 'Open the URL in the message: fix the path, restore the missing file, or remove the reference if it is no longer needed. Watch for hard-coded http:// URLs, references to a deleted plugin/theme asset, or a staging-only path.',
    lockedTip: 'The file lives in the theme/plugin or media library, so this usually needs template or hosting access. Check the referenced URL, re-upload the missing asset, or remove the dead reference at its source.',
  },
  brokenImages: {
    label: 'An image is broken and shows nothing',
    severity: 'error', scope: 'document', method: 'content',
    sc: null, url: null,
    why: 'An <img> on the page points at a file that will not load, so visitors see an empty box or a broken-image icon instead of the picture. It looks unfinished and erodes trust.',
    tip: 'Re-upload or relink the image so its src resolves, or remove the element if the image is no longer needed.',
    lockedTip: 'Fix the image in the page/media library — re-upload it or pick a working file. CSS/JS cannot recreate a missing image (a purely decorative one can be hidden, but that is rarely what you want).',
  },
  viewportMeta: {
    label: 'Missing or broken mobile viewport tag',
    severity: 'error', scope: 'document', method: 'markup',
    sc: '1.4.10', url: 'https://www.w3.org/WAI/WCAG22/Understanding/reflow.html',
    why: 'Without a proper <meta name="viewport"> tag the page does not adapt to phone screens — it renders zoomed-out and tiny — or, if the tag disables zooming, visitors with low vision cannot pinch to enlarge it. Either way the mobile experience is broken.',
    tip: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the <head>, and do not set user-scalable=no or maximum-scale=1.',
    lockedTip: 'This tag lives in the theme\'s <head>, so it usually needs template access (most themes already include it — check that a plugin has not overridden it). A JS fallback can inject it, but fixing it at the template is the reliable fix.',
  },
  consoleErrors: {
    label: 'JavaScript errors in the browser console',
    severity: 'warning', scope: 'document', method: 'js',
    sc: null, url: null,
    why: 'The page logged JavaScript errors while loading. These frequently break interactive features — menus, sliders, forms, add-to-cart — even when the page looks fine at a glance, so they are worth investigating.',
    tip: 'Open the browser dev-tools console on the affected page, reproduce the error, and trace it to the responsible theme or plugin script. Update or replace the offending code.',
    lockedTip: 'Most console errors come from theme/plugin scripts you do not control directly. Identify the failing script from the message; you can sometimes patch around it with your own JS, but the real fix is usually in the plugin/theme or its settings.',
  },
  tapTargets: {
    label: 'Tap target is too small for a finger',
    severity: 'warning', scope: 'viewport', method: 'css',
    sc: '2.5.8', url: 'https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html',
    why: 'A button or link is smaller than a fingertip can reliably hit on a phone, so visitors miss-tap or have to zoom in. Comfortable tap targets make the site faster and less frustrating to use on mobile.',
    tip: 'Give small links and buttons more room: increase padding or set a min-height/min-width (24px is the minimum, 44px is comfortable for mobile).',
    lockedTip: 'In Additional CSS, enlarge the target: e.g. .small-link{display:inline-block;min-height:44px;min-width:44px;padding:12px}. Spacing between adjacent targets helps too.',
  },
  smallText: {
    label: 'Body text is too small to read on mobile',
    severity: 'warning', scope: 'viewport', method: 'css',
    sc: null, url: 'https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html',
    why: 'Text on the page renders smaller than is comfortable to read on a phone, forcing visitors to squint or zoom. Readable body text keeps people on the page.',
    tip: 'Use at least ~16px for body copy on mobile and avoid tiny fixed font sizes; use relative units so text scales.',
    lockedTip: 'In Additional CSS, bump the offending selector\'s font-size — e.g. @media (max-width:600px){.fineprint{font-size:16px}}. Prefer rem/em over fixed px so it scales.',
  },
  elementOverflow: {
    label: 'An element spills outside its container',
    severity: 'warning', scope: 'viewport', method: 'css',
    sc: null, url: null,
    why: 'A piece of content extends past the box that is supposed to contain it, so it overlaps neighboring content or pokes out of its section. It usually signals a layout that did not adapt to this screen width.',
    tip: 'Constrain the child (max-width:100%, box-sizing:border-box), let the container grow or wrap, or allow the container to scroll if the content is genuinely wide (e.g. a table).',
    lockedTip: 'In Additional CSS, cap the child or let the parent cope: e.g. .child{max-width:100%} or .container{overflow-x:auto}. Full-bleed/negative-margin sections can be legitimate — confirm before changing.',
  },
  collapsedContainer: {
    label: 'A container collapsed to zero size',
    severity: 'warning', scope: 'viewport', method: 'css',
    sc: null, url: null,
    why: 'A section that contains content is rendering with no height or width, so whatever is inside it is invisible. It often means a broken flex/grid/float layout on this screen size.',
    tip: 'Check the container\'s layout: a float-only child with no clearfix, a flex/grid item with min-height:0, or a height tied to content that did not load. Give it an explicit size or fix the layout rule.',
    lockedTip: 'In Additional CSS, give the collapsed box a size or fix its layout — e.g. .box{min-height:auto;display:flow-root} to contain floats. Some accordions/tabs collapse on purpose, so verify it is actually a bug first.',
  },
  elementOverlap: {
    label: 'Text overlaps other content (experimental)',
    severity: 'notice', scope: 'viewport', method: 'css',
    sc: null, url: null,
    why: 'Two pieces of text appear to sit on top of each other, which can make both unreadable. This check is experimental — layered designs and decorative overlaps can trigger it — so treat it as a prompt to look, not a definite fault.',
    tip: 'If the overlap is unintended, give the elements room (margins/padding), fix the positioning, or adjust the layout so they no longer collide at this width.',
    lockedTip: 'In Additional CSS, separate the colliding elements with margin/padding or correct their position. Confirm visually first — intentional layered/overlay designs will trip this check.',
  },
};

// Returns the full render-time metadata bundle (same field set render builds
// from wcag.forSC + wcag.fix), falling back gracefully for unknown ids.
function forCheck(id) {
  const c = CHECKS[id] || {};
  return {
    label: c.label || id,
    sc: c.sc || null,
    url: c.url || null,
    tip: c.tip || null,
    why: c.why || WHY_FALLBACK,
    method: c.method || 'markup',
    lockedTip: c.lockedTip || null,
    severity: c.severity || 'warning',
    scope: c.scope || 'viewport',
  };
}

function severityOf(id) { return (CHECKS[id] || {}).severity || 'warning'; }
function scopeOf(id) { return (CHECKS[id] || {}).scope || 'viewport'; }

// Ids of all known checks (handy for config validation / defaults).
const ALL = Object.keys(CHECKS);

module.exports = { forCheck, severityOf, scopeOf, ALL };
