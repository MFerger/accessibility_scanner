'use strict';

/*
 * Map a pa11y issue (axe or htmlcs runner) to display metadata:
 *   describe(issue) -> { sc, url, tip, impact }
 *   why(sc)         -> one or two plain-language sentences on why it matters
 *
 * Coverage is the full set of WCAG 2.2 Level A and AA success criteria, so any
 * code pa11y can emit resolves to a real explanation. htmlcs codes embed the SC
 * (e.g. "...Guideline1_4.1_4_3..." -> 1.4.3); axe rule ids are mapped to their
 * primary SC via AXE_SC below.
 *
 * "tip" = how to fix (short). "why" = why it matters, written for a
 * non-technical reader to paste straight into a client report.
 */

// SC number -> { name, slug (w3.org Understanding page), tip, why }
const WCAG = {
  '1.1.1': { name: 'Non-text Content', slug: 'non-text-content',
    tip: 'Give informative images descriptive alt text; mark purely decorative images with empty alt="".',
    why: 'People who are blind or have low vision use screen readers that read out a text alternative instead of showing the image. Without alt text they get nothing — or a meaningless file name — where there should be information.' },
  '1.2.1': { name: 'Audio-only and Video-only (Prerecorded)', slug: 'audio-only-and-video-only-prerecorded',
    tip: 'Provide a transcript for audio-only, and a text or audio alternative for video-only.',
    why: 'People who are deaf or blind cannot access media that has no alternative. A transcript or description gives them the same information.' },
  '1.2.2': { name: 'Captions (Prerecorded)', slug: 'captions-prerecorded',
    tip: 'Add synchronized captions to prerecorded video that has sound.',
    why: 'People who are deaf or hard of hearing rely on captions to follow a video. Without them the spoken content is simply lost.' },
  '1.2.3': { name: 'Audio Description or Media Alternative (Prerecorded)', slug: 'audio-description-or-media-alternative-prerecorded',
    tip: 'Provide an audio description or a full text alternative for the video.',
    why: 'People who are blind miss the visual information in a video. A description or text alternative conveys what is happening on screen.' },
  '1.2.4': { name: 'Captions (Live)', slug: 'captions-live',
    tip: 'Provide real-time captions for live audio content.',
    why: 'People who are deaf or hard of hearing need live captions to follow real-time content such as webinars and broadcasts.' },
  '1.2.5': { name: 'Audio Description (Prerecorded)', slug: 'audio-description-prerecorded',
    tip: 'Add an audio description track for important visual content.',
    why: 'People who are blind need narration of important on-screen details that the dialogue alone does not convey.' },
  '1.3.1': { name: 'Info and Relationships', slug: 'info-and-relationships',
    tip: 'Use real headings, lists, table headers, and <label>s instead of visual styling alone.',
    why: 'Screen readers depend on real headings, lists, labels, and table headers in the code to convey how a page is organized. When structure is only visual, that meaning is lost to people who cannot see the layout.' },
  '1.3.2': { name: 'Meaningful Sequence', slug: 'meaningful-sequence',
    tip: 'Make the DOM order match the intended reading order; don\'t reorder meaning with CSS.',
    why: 'Screen readers and keyboard users follow the order of the code, not the visual layout. If those disagree, the page can read as nonsense.' },
  '1.3.3': { name: 'Sensory Characteristics', slug: 'sensory-characteristics',
    tip: 'Don\'t rely on shape, size, or position alone — also identify elements by name or text.',
    why: 'Instructions like "press the round button on the right" fail people who cannot perceive shape, size, or location. Content should also be identifiable by its name.' },
  '1.3.4': { name: 'Orientation', slug: 'orientation',
    tip: 'Don\'t lock the page to a single orientation unless it is essential.',
    why: 'People who mount a device in a fixed position, or who cannot rotate it, are locked out when content only works one way up.' },
  '1.3.5': { name: 'Identify Input Purpose', slug: 'identify-input-purpose',
    tip: 'Add appropriate autocomplete attributes to fields that collect personal data.',
    why: 'Telling the browser what a field collects lets it autofill, which helps people with memory, motor, or cognitive difficulties complete forms.' },
  '1.4.1': { name: 'Use of Color', slug: 'use-of-color',
    tip: 'Add a non-color cue (underline, icon, or text) wherever color conveys meaning.',
    why: 'People who are colorblind or have low vision may not perceive color differences. Anything signaled by color alone — a link inside text, a required field, an error — needs a second cue.' },
  '1.4.2': { name: 'Audio Control', slug: 'audio-control',
    tip: 'Don\'t autoplay sound for more than 3 seconds, or provide a pause/stop control.',
    why: 'Audio that plays automatically clashes with screen readers and distracts people with attention difficulties. Users need a way to stop it.' },
  '1.4.3': { name: 'Contrast (Minimum)', slug: 'contrast-minimum',
    tip: 'Use at least 4.5:1 contrast for normal text and 3:1 for large or bold text.',
    why: 'Text that is too close in color to its background is hard or impossible to read for people with low vision or aging eyes, or on a bright screen.' },
  '1.4.4': { name: 'Resize Text', slug: 'resize-text',
    tip: 'Use relative units and flexible layouts so text scales to 200% without loss.',
    why: 'People with low vision enlarge text to read it. The page must stay usable — nothing clipped or overlapping — when they do.' },
  '1.4.5': { name: 'Images of Text', slug: 'images-of-text',
    tip: 'Use real text instead of pictures of text wherever possible.',
    why: 'Text baked into an image cannot be resized, recolored, or read aloud by a screen reader. Real text adapts to each person\'s needs.' },
  '1.4.10': { name: 'Reflow', slug: 'reflow',
    tip: 'Use responsive layouts so content reflows into one column at 320 CSS px wide.',
    why: 'People who zoom in to read should not have to scroll sideways for every line. Content should reflow into a single column.' },
  '1.4.11': { name: 'Non-text Contrast', slug: 'non-text-contrast',
    tip: 'Give UI controls, icons, and focus indicators at least 3:1 contrast against adjacent colors.',
    why: 'Buttons, form borders, icons, and focus outlines must stand out enough for people with low vision to find and use them.' },
  '1.4.12': { name: 'Text Spacing', slug: 'text-spacing',
    tip: 'Avoid fixed heights and clipping so increased line/letter/word spacing doesn\'t break the layout.',
    why: 'Some people increase spacing between lines and letters to read more easily. Content must not get cut off or overlap when they do.' },
  '1.4.13': { name: 'Content on Hover or Focus', slug: 'content-on-hover-or-focus',
    tip: 'Make hover/focus popups dismissable, hoverable, and persistent until dismissed.',
    why: 'Tooltips and menus that appear on hover or focus can trap or block people using screen magnification or a keyboard if they can\'t be dismissed or reached.' },
  '2.1.1': { name: 'Keyboard', slug: 'keyboard',
    tip: 'Ensure every control and action works with the keyboard alone.',
    why: 'Many people cannot use a mouse and navigate entirely by keyboard. Anything that only works with a mouse is unavailable to them.' },
  '2.1.2': { name: 'No Keyboard Trap', slug: 'no-keyboard-trap',
    tip: 'Make sure keyboard focus can always move out of every component.',
    why: 'If focus gets stuck inside a widget, keyboard-only users cannot escape and the rest of the page becomes unreachable.' },
  '2.1.4': { name: 'Character Key Shortcuts', slug: 'character-key-shortcuts',
    tip: 'Let users remap or turn off single-character keyboard shortcuts.',
    why: 'Single-key shortcuts fire by accident for people using speech input or who bump keys. They should be remappable or off by default.' },
  '2.2.1': { name: 'Timing Adjustable', slug: 'timing-adjustable',
    tip: 'Allow users to turn off, adjust, or extend any time limit.',
    why: 'Time limits exclude people who read, type, or move more slowly. They need a way to extend or remove the limit.' },
  '2.2.2': { name: 'Pause, Stop, Hide', slug: 'pause-stop-hide',
    tip: 'Provide controls to pause, stop, or hide moving or auto-updating content.',
    why: 'Moving, blinking, or auto-scrolling content distracts people with attention and reading difficulties and must be pausable.' },
  '2.3.1': { name: 'Three Flashes or Below Threshold', slug: 'three-flashes-or-below-threshold',
    tip: 'Avoid content that flashes more than three times per second.',
    why: 'Content that flashes more than three times a second can trigger seizures in people with photosensitive epilepsy.' },
  '2.4.1': { name: 'Bypass Blocks', slug: 'bypass-blocks',
    tip: 'Add a skip-to-content link and use landmark regions.',
    why: 'Keyboard and screen-reader users otherwise have to pass through the same menus on every page. A skip link or landmarks let them jump straight to the main content.' },
  '2.4.2': { name: 'Page Titled', slug: 'page-titled',
    tip: 'Give every page a unique, descriptive <title>.',
    why: 'A clear, unique page title tells screen-reader users — and anyone juggling many tabs — which page they are on.' },
  '2.4.3': { name: 'Focus Order', slug: 'focus-order',
    tip: 'Order the DOM so keyboard focus moves in a logical sequence.',
    why: 'If focus jumps around in an illogical order, the page becomes disorienting and hard to operate by keyboard.' },
  '2.4.4': { name: 'Link Purpose (In Context)', slug: 'link-purpose-in-context',
    tip: 'Write link text that describes its destination on its own.',
    why: 'Screen-reader users often bring up a list of links out of context. Vague text like "read more" or "click here" tells them nothing about where it leads.' },
  '2.4.5': { name: 'Multiple Ways', slug: 'multiple-ways',
    tip: 'Offer more than one way to find pages (navigation, search, sitemap).',
    why: 'People navigate differently — some search, some browse. More than one route helps everyone, especially people with cognitive differences.' },
  '2.4.6': { name: 'Headings and Labels', slug: 'headings-and-labels',
    tip: 'Use descriptive headings and form labels.',
    why: 'Clear, descriptive headings and labels help everyone — especially screen-reader users — understand and scan the page.' },
  '2.4.7': { name: 'Focus Visible', slug: 'focus-visible',
    tip: 'Keep a clearly visible focus outline; don\'t remove it in CSS.',
    why: 'Keyboard users need to see where they are. A visible focus indicator shows which control is currently active.' },
  '2.4.11': { name: 'Focus Not Obscured (Minimum)', slug: 'focus-not-obscured-minimum',
    tip: 'Make sure sticky headers or banners don\'t cover the focused control.',
    why: 'When the focused element hides behind sticky content, keyboard users lose track of where they are on the page.' },
  '2.5.1': { name: 'Pointer Gestures', slug: 'pointer-gestures',
    tip: 'Provide a simple single-pointer alternative to multipoint or path-based gestures.',
    why: 'Complex gestures like pinch or swipe-along-a-path exclude people who cannot perform them. A single tap alternative should exist.' },
  '2.5.2': { name: 'Pointer Cancellation', slug: 'pointer-cancellation',
    tip: 'Trigger actions on pointer-up, and allow the user to move off to cancel.',
    why: 'Firing actions on press, with no way to back out, causes accidental activations for people with motor difficulties.' },
  '2.5.3': { name: 'Label in Name', slug: 'label-in-name',
    tip: 'Include the visible label text within the control\'s accessible name.',
    why: 'When a control\'s spoken name does not contain its visible label, voice-control users who say the label cannot activate it.' },
  '2.5.4': { name: 'Motion Actuation', slug: 'motion-actuation',
    tip: 'Provide a conventional control as an alternative to motion-triggered actions.',
    why: 'Features triggered by shaking or tilting exclude people who cannot move the device or who have tremors. A standard control should also work.' },
  '2.5.7': { name: 'Dragging Movements', slug: 'dragging-movements',
    tip: 'Offer a click or tap alternative to any drag-based action.',
    why: 'Drag-and-drop is hard or impossible for people with motor difficulties. A single-tap alternative lets them do the same task.' },
  '2.5.8': { name: 'Target Size (Minimum)', slug: 'target-size-minimum',
    tip: 'Make tap targets at least 24×24 CSS px, or add spacing around them.',
    why: 'Small targets are hard to hit accurately for people with limited dexterity or on a touchscreen, causing errors and frustration.' },
  '3.1.1': { name: 'Language of Page', slug: 'language-of-page',
    tip: 'Set the page language with <html lang="…">.',
    why: 'Declaring the page language lets screen readers pronounce the words correctly instead of mangling them.' },
  '3.1.2': { name: 'Language of Parts', slug: 'language-of-parts',
    tip: 'Mark inline foreign-language phrases with a lang attribute.',
    why: 'Marking phrases in another language lets screen readers switch pronunciation so the content stays understandable.' },
  '3.2.1': { name: 'On Focus', slug: 'on-focus',
    tip: 'Don\'t trigger context changes simply because an element receives focus.',
    why: 'Unexpected changes — like a new window opening — when an element merely gets focus disorient screen-reader and keyboard users.' },
  '3.2.2': { name: 'On Input', slug: 'on-input',
    tip: 'Don\'t auto-submit or navigate away when a field\'s value changes.',
    why: 'Surprising changes when someone selects an option or types confuse people and can make them lose their place.' },
  '3.2.3': { name: 'Consistent Navigation', slug: 'consistent-navigation',
    tip: 'Keep navigation in the same place and order across pages.',
    why: 'Consistent navigation helps people with cognitive and visual disabilities know where to look on every page.' },
  '3.2.4': { name: 'Consistent Identification', slug: 'consistent-identification',
    tip: 'Use the same name and icon for the same function throughout the site.',
    why: 'Naming the same function differently on different pages confuses people who rely on those labels and cues.' },
  '3.2.6': { name: 'Consistent Help', slug: 'consistent-help',
    tip: 'Put help and contact options in a consistent place across pages.',
    why: 'People who need assistance can find it reliably when help lives in the same place on every page.' },
  '3.3.1': { name: 'Error Identification', slug: 'error-identification',
    tip: 'Describe form errors in text and point to the field that needs fixing.',
    why: 'When an error is shown only by color or is vague, screen-reader users and people with cognitive difficulties can\'t tell what went wrong.' },
  '3.3.2': { name: 'Labels or Instructions', slug: 'labels-or-instructions',
    tip: 'Provide visible labels and instructions for form fields.',
    why: 'Without visible labels and instructions people have to guess what a field wants — a barrier for everyone, and especially screen-reader users.' },
  '3.3.3': { name: 'Error Suggestion', slug: 'error-suggestion',
    tip: 'Suggest how to correct an input error when you can.',
    why: 'Just saying "invalid" isn\'t enough; suggesting the fix helps people complete the form successfully.' },
  '3.3.4': { name: 'Error Prevention (Legal, Financial, Data)', slug: 'error-prevention-legal-financial-data',
    tip: 'Allow review, confirmation, or reversal for important submissions.',
    why: 'For legal, financial, or data actions, people need a chance to check or undo to prevent costly mistakes.' },
  '3.3.7': { name: 'Redundant Entry', slug: 'redundant-entry',
    tip: 'Reuse or auto-populate information the user already entered.',
    why: 'Re-entering the same details burdens people with memory or motor difficulties; previously entered data should carry over.' },
  '3.3.8': { name: 'Accessible Authentication (Minimum)', slug: 'accessible-authentication-minimum',
    tip: 'Offer a login path that doesn\'t require memorizing or transcribing something.',
    why: 'Logins that depend on remembering or copying codes exclude people with cognitive disabilities; a simpler method should exist.' },
  '4.1.1': { name: 'Parsing (obsolete)', slug: 'parsing',
    tip: 'Avoid duplicate IDs and keep markup well-formed.',
    why: 'Broken or duplicated markup could once confuse assistive technology. This criterion was retired in WCAG 2.2, but clean markup still helps.' },
  '4.1.2': { name: 'Name, Role, Value', slug: 'name-role-value',
    tip: 'Give custom controls a proper name, role, and state (often via ARIA).',
    why: 'Custom buttons, menus, and widgets need a name, role, and state in the code so screen readers can announce what they are and whether they are on or off.' },
  '4.1.3': { name: 'Status Messages', slug: 'status-messages',
    tip: 'Expose status messages with role="status" or an aria-live region.',
    why: 'Updates like "added to cart" that appear without moving focus must be announced, or screen-reader users never know they happened.' },
};

// axe rule id -> primary WCAG SC, so axe issues resolve to an explained SC.
const AXE_SC = {
  'area-alt': '1.1.1', 'image-alt': '1.1.1', 'input-image-alt': '1.1.1', 'object-alt': '1.1.1',
  'role-img-alt': '1.1.1', 'svg-img-alt': '1.1.1', 'image-redundant-alt': '1.1.1',
  'aria-meter-name': '1.1.1', 'aria-progressbar-name': '1.1.1',
  'video-caption': '1.2.2',
  'definition-list': '1.3.1', 'dlitem': '1.3.1', 'list': '1.3.1', 'listitem': '1.3.1',
  'heading-order': '1.3.1', 'empty-heading': '1.3.1', 'p-as-heading': '1.3.1', 'page-has-heading-one': '1.3.1',
  'region': '1.3.1', 'landmark-one-main': '1.3.1', 'landmark-unique': '1.3.1',
  'landmark-banner-is-top-level': '1.3.1', 'landmark-complementary-is-top-level': '1.3.1',
  'landmark-contentinfo-is-top-level': '1.3.1', 'landmark-main-is-top-level': '1.3.1',
  'landmark-no-duplicate-banner': '1.3.1', 'landmark-no-duplicate-contentinfo': '1.3.1',
  'landmark-no-duplicate-main': '1.3.1', 'aria-required-children': '1.3.1', 'aria-required-parent': '1.3.1',
  'td-headers-attr': '1.3.1', 'th-has-data-cells': '1.3.1', 'td-has-header': '1.3.1',
  'scope-attr-valid': '1.3.1', 'table-duplicate-name': '1.3.1', 'table-fake-caption': '1.3.1',
  'autocomplete-valid': '1.3.5',
  'link-in-text-block': '1.4.1',
  'color-contrast': '1.4.3', 'color-contrast-enhanced': '1.4.6',
  'meta-viewport': '1.4.4', 'meta-viewport-large': '1.4.4',
  'avoid-inline-spacing': '1.4.12',
  'scrollable-region-focusable': '2.1.1', 'server-side-image-map': '2.1.1', 'frame-focusable-content': '2.1.1',
  'blink': '2.2.2', 'marquee': '2.2.2', 'meta-refresh': '2.2.1',
  'bypass': '2.4.1', 'frame-title': '2.4.1', 'frame-title-unique': '2.4.1',
  'document-title': '2.4.2', 'tabindex': '2.4.3', 'link-name': '2.4.4', 'skip-link': '2.4.1',
  'target-size': '2.5.8',
  'html-has-lang': '3.1.1', 'html-lang-valid': '3.1.1', 'html-xml-lang-mismatch': '3.1.1', 'valid-lang': '3.1.2',
  'label': '4.1.2', 'label-title-only': '3.3.2', 'form-field-multiple-labels': '3.3.2',
  'button-name': '4.1.2', 'input-button-name': '4.1.2', 'select-name': '4.1.2', 'nested-interactive': '4.1.2',
  'aria-allowed-attr': '4.1.2', 'aria-allowed-role': '4.1.2', 'aria-command-name': '4.1.2',
  'aria-hidden-body': '4.1.2', 'aria-hidden-focus': '4.1.2', 'aria-input-field-name': '4.1.2',
  'aria-required-attr': '4.1.2', 'aria-roles': '4.1.2', 'aria-toggle-field-name': '4.1.2',
  'aria-tooltip-name': '4.1.2', 'aria-valid-attr': '4.1.2', 'aria-valid-attr-value': '4.1.2',
  'aria-dialog-name': '4.1.2', 'aria-text': '4.1.2', 'presentation-role-conflict': '4.1.2',
  'duplicate-id-aria': '4.1.2', 'duplicate-id-active': '4.1.1', 'duplicate-id': '4.1.1',
};

function understandingUrl(sc) {
  const entry = WCAG[sc];
  return entry
    ? 'https://www.w3.org/WAI/WCAG22/Understanding/' + entry.slug + '.html'
    : 'https://www.w3.org/WAI/WCAG22/quickref/';
}

// Pull "1.4.3" out of an htmlcs code like "...Guideline1_4.1_4_3.G18.Abs".
function scFromCode(code) {
  const m = String(code == null ? '' : code).match(/(\d+)_(\d+)_(\d+)/);
  return m ? m[1] + '.' + m[2] + '.' + m[3] : null;
}

// axe messages end with " (https://dequeuniversity.com/...)" — drop it.
function cleanMessage(message) {
  return String(message == null ? '' : message).replace(/\s*\(https?:\/\/[^)]+\)\s*$/, '').trim();
}

const WHY_FALLBACK =
  'This affects how easily people using assistive technology, or with vision, motor, or cognitive differences, can use the page.';

function why(sc) {
  return (sc && WCAG[sc] && WCAG[sc].why) || WHY_FALLBACK;
}

// Display metadata derived purely from the SC, so reports re-derive it on a
// rebuild (picking up edits here) instead of using values frozen at scan time.
// Fields are null when the SC is unknown, so callers can fall back to whatever
// the scan captured (e.g. an axe rule's own help text/link).
function forSC(sc) {
  const e = sc && WCAG[sc];
  return {
    name: e ? e.name : null,
    url: e ? understandingUrl(sc) : null,
    tip: e ? e.tip : null,
    why: why(sc),
  };
}

function describe(issue) {
  const x = issue.runnerExtras || {};
  const isAxe = issue.runner === 'axe' || !!x.helpUrl;
  let sc = scFromCode(issue.code);
  if (!sc && isAxe) sc = AXE_SC[issue.code] || null;

  const entry = (sc && WCAG[sc]) || null;
  const tip = (entry && entry.tip) || x.help || x.description || '';
  // Link to the authoritative WCAG page when we know the SC (it matches the
  // "WCAG x.y.z" label); fall back to the axe/Deque help page otherwise.
  const url = sc ? understandingUrl(sc) : (x.helpUrl || understandingUrl(null));
  const impact = x.impact || null; // critical | serious | moderate | minor

  return { sc, url, tip, impact };
}

module.exports = { describe, why, forSC, cleanMessage, scFromCode, understandingUrl };
