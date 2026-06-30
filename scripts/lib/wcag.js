'use strict';

/*
 * Map a pa11y issue (axe or htmlcs runner) to display metadata:
 *   { sc, url, tip, impact }
 *
 * - axe issues carry runnerExtras (impact / help / description / helpUrl);
 *   we lean on those and link to the Deque help page.
 * - htmlcs codes embed the WCAG success criterion, e.g.
 *   "WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Abs" -> SC 1.4.3, which we
 *   parse and map to a W3C "Understanding" page + a curated remediation tip.
 */

// SC number -> [ w3.org Understanding slug, short remediation tip ]
const SC = {
  '1.1.1': ['non-text-content', 'Give images meaningful alt text; use empty alt="" for purely decorative images.'],
  '1.3.1': ['info-and-relationships', 'Convey structure in markup: real headings, lists, table headers, and labels tied to inputs.'],
  '1.3.5': ['identify-input-purpose', 'Add autocomplete attributes to inputs that collect a user\'s own information.'],
  '1.4.1': ['use-of-color', 'Don\'t rely on color alone — underline links or add a second visual cue.'],
  '1.4.3': ['contrast-minimum', 'Use at least 4.5:1 text contrast (3:1 for large or bold text).'],
  '1.4.4': ['resize-text', 'Ensure text can scale to 200% without losing content or function.'],
  '1.4.10': ['reflow', 'Avoid horizontal scrolling at 320px wide; let content reflow into one column.'],
  '1.4.11': ['non-text-contrast', 'Give UI controls and meaningful graphics at least 3:1 contrast against adjacent colors.'],
  '1.4.12': ['text-spacing', 'Content must survive increased line/letter/word spacing without clipping.'],
  '2.4.1': ['bypass-blocks', 'Provide a skip link and/or landmark regions to bypass repeated blocks.'],
  '2.4.2': ['page-titled', 'Give every page a unique, descriptive <title>.'],
  '2.4.4': ['link-purpose-in-context', 'Make link text describe its destination; avoid bare "read more".'],
  '2.4.6': ['headings-and-labels', 'Use descriptive headings and form labels.'],
  '2.4.7': ['focus-visible', 'Keep a clearly visible keyboard focus indicator.'],
  '2.5.3': ['label-in-name', 'A control\'s accessible name must contain its visible label text.'],
  '2.5.8': ['target-size-minimum', 'Make touch targets at least 24x24 CSS px (or add spacing).'],
  '3.1.1': ['language-of-page', 'Set the page language with <html lang="...">.'],
  '3.3.2': ['labels-or-instructions', 'Provide visible labels or instructions for form fields.'],
  '4.1.2': ['name-role-value', 'Give interactive elements an accessible name and correct role/state.'],
};

// Common axe rule ids -> SC number, for display when the code isn't a WCAG path.
const AXE_SC = {
  'color-contrast': '1.4.3',
  'link-in-text-block': '1.4.1',
  'image-alt': '1.1.1',
  'input-image-alt': '1.1.1',
  'area-alt': '1.1.1',
  'object-alt': '1.1.1',
  'svg-img-alt': '1.1.1',
  'document-title': '2.4.2',
  'html-has-lang': '3.1.1',
  'html-lang-valid': '3.1.1',
  'valid-lang': '3.1.2',
  'heading-order': '1.3.1',
  'empty-heading': '1.3.1',
  'region': '1.3.1',
  'landmark-one-main': '1.3.1',
  'landmark-unique': '1.3.1',
  'landmark-no-duplicate-banner': '1.3.1',
  'list': '1.3.1',
  'listitem': '1.3.1',
  'definition-list': '1.3.1',
  'td-headers-attr': '1.3.1',
  'th-has-data-cells': '1.3.1',
  'label': '4.1.2',
  'button-name': '4.1.2',
  'link-name': '2.4.4',
  'select-name': '4.1.2',
  'aria-required-attr': '4.1.2',
  'aria-valid-attr-value': '4.1.2',
  'aria-allowed-attr': '4.1.2',
  'aria-roles': '4.1.2',
  'duplicate-id-aria': '4.1.2',
  'frame-title': '2.4.1',
  'bypass': '2.4.1',
  'target-size': '2.5.8',
  'meta-viewport': '1.4.4',
};

function understandingUrl(sc) {
  const entry = SC[sc];
  return entry
    ? 'https://www.w3.org/WAI/WCAG22/Understanding/' + entry[0] + '.html'
    : 'https://www.w3.org/WAI/WCAG22/quickref/';
}

// Pull "1.4.3" out of an htmlcs code like "...Guideline1_4.1_4_3.G18.Abs".
function scFromCode(code) {
  const m = String(code == null ? '' : code).match(/(\d+)_(\d+)_(\d+)/);
  return m ? m[1] + '.' + m[2] + '.' + m[3] : null;
}

// axe messages end with " (https://dequeuniversity.com/...)" — drop it; we
// render the URL as a proper link instead.
function cleanMessage(message) {
  return String(message == null ? '' : message).replace(/\s*\(https?:\/\/[^)]+\)\s*$/, '').trim();
}

function describe(issue) {
  const x = issue.runnerExtras || {};
  const isAxe = issue.runner === 'axe' || !!x.helpUrl;
  let sc = scFromCode(issue.code);
  if (!sc && isAxe) sc = AXE_SC[issue.code] || null;

  const tip = (SC[sc] && SC[sc][1]) || x.help || x.description || '';
  const url = x.helpUrl || understandingUrl(sc);
  const impact = x.impact || null; // critical | serious | moderate | minor

  return { sc, url, tip, impact };
}

module.exports = { describe, cleanMessage, scFromCode, understandingUrl };
