'use strict';

/*
 * HTML rendering for the accessibility reports. Everything is a single
 * self-contained HTML file per page — inline CSS, inline vanilla JS, no build
 * step and no runtime dependencies. Two exports:
 *
 *   landing(sites)  -> the homepage listing every scanned site
 *   site(site)      -> one interactive per-site report
 */

const wcag = require('./lib/wcag');
const uxChecks = require('./lib/ux-checks');

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// JSON that is safe to drop inside a <script> tag (no </script> break-out).
const jsonScript = (obj) => JSON.stringify(obj)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

const fmtDate = (iso) => String(iso || '').slice(0, 10) || '—';
const sevRank = (t) => (t === 'error' ? 0 : t === 'warning' ? 1 : 2);

// Fix-method display: badge text, "fixable by you" bucket, access label.
const METHOD = {
  css: { badge: 'CSS', fixable: true, label: 'CSS' },
  js: { badge: 'JS', fixable: true, label: 'JS' },
  markup: { badge: 'Template', fixable: false, label: 'template' },
  content: { badge: 'CMS', fixable: false, label: 'CMS' },
};
const methodOf = (m) => METHOD[m] || METHOD.markup;

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------

// Sets data-theme before first paint so a saved dark choice doesn't flash.
const THEME_BOOT = '<script>(function(){try{var t=localStorage.getItem("a11y-theme");' +
  'if(t)document.documentElement.setAttribute("data-theme",t);}catch(e){}})();</script>';

const STYLES = `
:root{
  --bg:#ffffff;--fg:#1a1a1a;--muted:#6b7280;--card:#ffffff;--border:#e5e7eb;
  --line:#eef0f2;--code:#1c2129;--codefg:#e6e9ef;--accent:#2563eb;--chip:#f3f4f6;
  --err:#c0392b;--warn:#9a6700;--notice:#2c6e8f;--ok:#2a7a3a;--shadow:0 1px 2px rgba(0,0,0,.05);
}
[data-theme=dark]{
  --bg:#0f1419;--fg:#e6e9ef;--muted:#9aa4b2;--card:#161b22;--border:#2a313c;
  --line:#222831;--code:#0b0e13;--codefg:#e6e9ef;--accent:#6aa3ff;--chip:#1d2530;--shadow:none;
}
*{box-sizing:border-box}
body{font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;max-width:980px;margin:0 auto;
  padding:24px 20px 64px;color:var(--fg);background:var(--bg);-webkit-text-size-adjust:100%}
a{color:var(--accent)}
h1{margin:0 0 4px;font-size:24px}
.meta{color:var(--muted);margin:0 0 20px;font-size:13px;word-break:break-all}
.muted{color:var(--muted)} .ok{color:var(--ok);margin:0}
.row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.spacer,.ghspacer{flex:1 1 auto}

.sum{display:flex;gap:22px;flex-wrap:wrap;margin:14px 0 6px}
.sum .n{font-size:26px;font-weight:700;line-height:1}
.sum .k{font-size:12px;color:var(--muted)}
.sum .err .n{color:var(--err)} .sum .warn .n{color:var(--warn)} .sum .notice .n{color:var(--notice)}
.badges{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 0}
.pill{font-size:12px;padding:2px 9px;border-radius:999px;background:var(--chip);color:var(--fg)}
.pill.new{background:rgba(37,99,235,.12);color:var(--accent)}
.pill.resolved{background:rgba(42,122,58,.14);color:var(--ok)}
.spark{color:var(--accent);vertical-align:middle}

.controls{position:sticky;top:0;z-index:5;background:var(--bg);padding:10px 0;margin:8px 0 14px;
  border-bottom:1px solid var(--border)}
.controls button,.controls input,.controls label{font:inherit}
.btn{border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:7px;padding:5px 11px;cursor:pointer}
.btn.active{background:var(--accent);border-color:var(--accent);color:#fff}
.seg{display:inline-flex;border:1px solid var(--border);border-radius:7px;overflow:hidden}
.seg .btn{border:0;border-radius:0}
.chip{border:1px solid var(--border);background:var(--card);color:var(--muted);border-radius:999px;padding:4px 11px;cursor:pointer}
.chip.on{color:var(--fg)}
.chip.error.on{border-color:var(--err);color:var(--err)}
.chip.warning.on{border-color:var(--warn);color:var(--warn)}
.chip.notice.on{border-color:var(--notice);color:var(--notice)}
.q{border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:7px;padding:6px 10px;min-width:170px;flex:1 1 170px}
.ck{display:inline-flex;gap:6px;align-items:center;color:var(--muted);cursor:pointer;font-size:13px}
.lensrow{margin:0 0 8px}
.lensmeta{margin:14px 0 0}

/* page sections */
.pg{border:1px solid var(--border);border-radius:10px;padding:12px 16px;margin:0 0 12px;background:var(--card);box-shadow:var(--shadow)}
.pg.clean{opacity:.7}
.pg h2{font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;margin:0 0 10px;font-weight:600}
.pglink{color:var(--accent)} .pglink:hover{text-decoration:underline}
.pg h2 .pgcount{color:var(--muted);font-weight:400;font-family:system-ui,sans-serif;font-size:12px}

/* issue-type group */
.groups{display:flex;flex-direction:column;gap:10px}
.grp{border:1px solid var(--border);border-radius:8px;padding:10px 12px;background:var(--bg)}
.grp.empty{opacity:.55}
.grp-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.gtitle{font-size:14px}
.cnt{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.t{font-size:10.5px;text-transform:uppercase;font-weight:700;padding:1px 6px;border-radius:4px;color:#fff}
.t.error{background:var(--err)} .t.warning{background:var(--warn)} .t.notice{background:var(--notice)}
.sc{font-size:12px;white-space:nowrap}
.why{font-size:13px;margin:6px 0 0} .why b,.tip b{font-weight:600}
.grp .tip,.icard .tip{font-size:12.5px;color:var(--muted);margin:4px 0 0}
.copy,.dismiss-group,.copy-sel{font-size:11.5px;border:1px solid var(--border);background:var(--card);
  color:var(--muted);border-radius:6px;padding:2px 8px;cursor:pointer;white-space:nowrap}
.copy:hover,.dismiss-group:hover,.copy-sel:hover{color:var(--fg);border-color:var(--accent)}

.occ{margin:9px 0 0}
.occ>summary{font-size:12px;color:var(--muted);cursor:pointer;user-select:none}
.occ>summary:hover{color:var(--fg)}
ul.issues{list-style:none;margin:9px 0 0;padding:0}
.issue{display:flex;gap:10px;border-top:1px solid var(--line);padding:10px 0}
.issue:first-child{border-top:0}
.issue.is-dismissed{opacity:.5}
.issue .body{min-width:0;flex:1}
.imp{display:inline-block;font-size:10.5px;text-transform:uppercase;letter-spacing:.02em;color:var(--muted);
  border:1px solid var(--border);border-radius:4px;padding:0 5px;margin:0 0 4px}
.sel{display:flex;gap:8px;align-items:flex-start}
.sel code{flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;word-break:break-all;
  background:var(--chip);border-radius:5px;padding:4px 7px}
.issue pre{flex:1;background:var(--code);color:var(--codefg);padding:8px 10px;border-radius:6px;
  overflow:auto;font-size:12px;margin:6px 0 0;white-space:pre-wrap;word-break:break-word}
.issue pre code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dz{flex:0 0 auto;padding-top:2px}
.dz input{width:16px;height:16px;cursor:pointer}

/* by-issue cards */
.icard{border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin:0 0 10px;background:var(--card)}
.ic-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%}
.dot.error{background:var(--err)} .dot.warning{background:var(--warn)} .dot.notice{background:var(--notice)}
.icard .pages{font-size:12.5px;margin:9px 0 0;line-height:1.9}
.icard .pages .lbl{color:var(--muted);margin-right:4px}
.icard .pages a{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;
  background:var(--chip);border-radius:5px;padding:2px 7px;margin:0 4px 2px 0;display:inline-block;text-decoration:none}
.icard .pages a:hover{text-decoration:underline}

/* landing cards */
.cards{display:grid;gap:12px}
.card{display:block;border:1px solid var(--border);border-radius:12px;padding:16px;background:var(--card);
  text-decoration:none;color:inherit;box-shadow:var(--shadow)}
.card:hover{border-color:var(--accent)}
.card .name{font-size:17px;font-weight:600;margin:0}
.card .host{color:var(--muted);font-size:13px;word-break:break-all}
.card .stats{display:flex;gap:18px;align-items:center;margin-top:10px;flex-wrap:wrap}
.card .stat b{font-size:20px} .card .stat span{font-size:12px;color:var(--muted);margin-left:4px}

/* fix-method badges + locked-theme banding */
.mtag{font-size:10px;text-transform:uppercase;font-weight:700;letter-spacing:.03em;padding:1px 6px;border-radius:4px;border:1px solid transparent;white-space:nowrap}
.mtag.css{background:rgba(37,99,235,.12);color:var(--accent);border-color:rgba(37,99,235,.35)}
.mtag.js{background:rgba(42,122,58,.14);color:var(--ok);border-color:rgba(42,122,58,.35)}
.mtag.markup,.mtag.content{background:var(--chip);color:var(--muted);border-color:var(--border)}
.band{font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;color:var(--muted);padding:6px 0 3px;border-bottom:1px solid var(--border);margin:4px 0 2px;display:none}
.band-need{color:var(--warn)}
.fixsum{background:rgba(37,99,235,.10);color:var(--accent)}
.fixSummary:empty{display:none}
.vp{display:inline-block;font-size:10.5px;text-transform:uppercase;letter-spacing:.02em;color:var(--accent);
  border:1px solid rgba(37,99,235,.35);background:rgba(37,99,235,.08);border-radius:4px;padding:0 5px;margin:0 6px 4px 0}
.tip-locked{display:none}
/* locked mode (default): CSS/JS tips, two bands via flex order */
body.locked .tip-standard{display:none}
body.locked .tip-locked{display:block}
body.locked .band{display:block}
body.locked .band-fix{order:0}
body.locked .grp[data-fixable="1"]{order:1;border-left:3px solid var(--accent)}
body.locked .band-need{order:2}
body.locked .grp[data-fixable="0"]{order:3;border-left:3px solid var(--border)}
/* customizable mode: standard tips, no banding or summary */
body:not(.locked) .tip-locked{display:none}
body:not(.locked) .fixSummary{display:none}

/* filter visibility — scoped per lens so the two lenses filter independently */
.lens.hide-error .grp.error,.lens.hide-warning .grp.warning,.lens.hide-notice .grp.notice{display:none}
.lens.hide-error .byIssue .icard.error,.lens.hide-warning .byIssue .icard.warning,.lens.hide-notice .byIssue .icard.notice{display:none}
.lens.hide-dismissed .issue.is-dismissed{display:none}
.lens.hide-dismissed .grp.empty{display:none}
.grp.q-hide,.icard.q-hide{display:none}
[hidden]{display:none !important}
`;

function shell(title, bodyHtml, extraHead) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
${THEME_BOOT}
<style>${STYLES}</style>
${extraHead || ''}
</head><body class="locked">
${bodyHtml}
</body></html>
`;
}

// Inline SVG sparkline of errors over time (last ~14 scans).
function sparkline(history) {
  const rows = (history || []).slice(-14);
  if (rows.length < 2) return '';
  const vals = rows.map((r) => r.errors || 0);
  const max = Math.max.apply(null, vals.concat([1]));
  const min = Math.min.apply(null, vals.concat([0]));
  const span = (max - min) || 1;
  const W = 140, H = 34, pad = 3;
  const pts = vals.map((v, i) => {
    const x = pad + i * (W - 2 * pad) / (vals.length - 1);
    const y = pad + (H - 2 * pad) * (1 - (v - min) / span);
    return [x, y];
  });
  const poly = pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const last = pts[pts.length - 1];
  return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H +
    '" role="img" aria-label="Errors over the last ' + vals.length + ' scans">' +
    '<polyline fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" points="' + poly + '"/>' +
    '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="2.3" fill="currentColor"/></svg>';
}

// ---------------------------------------------------------------------------
// Landing page
// ---------------------------------------------------------------------------

function landing(sites) {
  const when = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const cards = sites.map((s) => {
    const a = s.active;
    return `<a class="card" href="sites/${esc(s.slug)}/">
  <p class="name">${esc(s.name)}</p>
  <div class="host">${esc(s.url)}</div>
  <div class="stats">
    <span class="stat err"><b style="color:var(--err)">${a.errors}</b><span>a11y errors</span></span>
    ${s.ux ? '<span class="stat"><b style="color:var(--err)">' + s.ux.active.errors + '</b><span>UX errors</span></span>' : ''}
    <span class="stat"><b>${a.total}</b><span>issues</span></span>
    <span class="stat"><b>${s.summary.pages}</b><span>pages</span></span>
    ${a.dismissed ? '<span class="stat"><b>' + a.dismissed + '</b><span>dismissed</span></span>' : ''}
    <span class="spacer"></span>${sparkline(s.history)}
  </div>
  <div class="host" style="margin-top:8px">Last scan ${esc(fmtDate(s.scannedAt))}</div>
</a>`;
  }).join('\n');

  const body = `<div class="row"><h1>Accessibility reports</h1><span class="spacer"></span>
<button class="btn" id="themeBtn" title="Toggle dark mode" aria-label="Toggle dark mode">◐</button></div>
<p class="meta">${sites.length} site${sites.length === 1 ? '' : 's'} &middot; generated ${when}</p>
<div class="cards">
${cards || '<p class="muted">No sites scanned yet.</p>'}
</div>
<script>
var tb=document.getElementById('themeBtn');
if(tb)tb.addEventListener('click',function(){var c=document.documentElement.getAttribute('data-theme');
var n=c==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',n);
try{localStorage.setItem('a11y-theme',n);}catch(e){}});
</script>`;
  return shell('Accessibility reports', body);
}

// ---------------------------------------------------------------------------
// Per-site report
// ---------------------------------------------------------------------------

function occurrence(it) {
  return `<li class="issue ${esc(it.type)}" data-fp="${esc(it.fp)}" data-code="${esc(it.code)}" data-type="${esc(it.type)}" data-impact="${esc(it.impact || '')}">
<label class="dz"><input type="checkbox" class="dismiss" aria-label="Dismiss this occurrence"></label>
<div class="body">
${it.viewport && it.viewport !== 'all' ? '<span class="vp" title="Appears at this screen size">' + esc(it.viewport) + '</span>' : ''}${it.impact ? '<span class="imp">' + esc(it.impact) + '</span>' : ''}
<div class="sel"><code>${esc(it.selector || '(no selector)')}</code><button class="copy-sel" type="button" title="Copy CSS selector">copy</button></div>
${it.context ? '<pre><code>' + esc(it.context) + '</code></pre>' : ''}
</div></li>`;
}

function group(g, codes) {
  const meta = codes[g.code] || {};
  const title = meta.label || g.code;
  const ref = meta.sc ? 'WCAG ' + meta.sc : 'Reference';
  const M = methodOf(meta.method);
  const occ = g.items.map(occurrence).join('\n');
  const lockedBody = M.fixable
    ? '<b>How to fix (' + M.badge + '):</b> ' + esc(meta.lockedTip || meta.tip || '')
    : '<b>Needs ' + M.label + ' access:</b> ' + esc(meta.lockedTip || meta.tip || '');
  return `<div class="grp ${esc(g.type)}${g.act === 0 ? ' empty' : ''}" data-code="${esc(g.code)}" data-method="${esc(meta.method || 'markup')}" data-fixable="${M.fixable ? 1 : 0}">
<div class="grp-head">
<span class="t ${esc(g.type)}">${esc(g.type)}</span>
<span class="mtag ${esc(meta.method || 'markup')}">${M.badge}</span>
<strong class="gtitle">${esc(title)}</strong>
<span class="cnt">${g.act}&times;</span>
${meta.url ? '<a class="sc" href="' + esc(meta.url) + '" target="_blank" rel="noopener">' + esc(ref) + '</a>' : ''}
<span class="ghspacer"></span>
<button class="copy" type="button" title="Copy title + why for your report">copy</button>
<button class="dismiss-group" type="button" title="Dismiss every occurrence of this issue on this page">dismiss all</button>
</div>
${meta.why ? '<div class="why"><b>Why it matters:</b> ' + esc(meta.why) + '</div>' : ''}
${meta.tip ? '<div class="tip tip-standard"><b>How to fix:</b> ' + esc(meta.tip) + '</div>' : ''}
<div class="tip tip-locked">${lockedBody}</div>
<details class="occ"><summary><span class="occn">${g.act}</span> occurrence${g.act === 1 ? '' : 's'} — show elements</summary>
<ul class="issues">${occ}</ul>
</details>
</div>`;
}

function pageSection(p, codes, dismissed) {
  const byCode = {};
  for (const it of p.issues) (byCode[it.code] = byCode[it.code] || []).push(it);
  const groups = Object.keys(byCode).map((code) => {
    const items = byCode[code];
    return {
      code, items, type: items[0].type,
      act: items.filter((i) => !dismissed.has(i.fp)).length,
      fixable: methodOf((codes[code] || {}).method).fixable,
    };
  }).sort((x, y) => sevRank(x.type) - sevRank(y.type) || y.act - x.act);

  // Band dividers (locked mode only, via CSS) — render only if non-empty.
  const divFix = groups.some((g) => g.fixable) ? '<div class="band band-fix">Fixable by you — CSS / JS</div>' : '';
  const divNeed = groups.some((g) => !g.fixable) ? '<div class="band band-need">Needs template / CMS access</div>' : '';
  const inner = groups.map((g) => group(g, codes)).join('\n');
  return `<section class="pg${p.act === 0 ? ' clean' : ''}" data-page="${esc(p.url)}">
<h2><a class="pglink" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a> <span class="pgcount">${p.errs} errors / ${p.act} issues</span></h2>
<div class="groups">${divFix}${divNeed}${inner || '<p class="ok">No issues found.</p>'}</div>
</section>`;
}

// One lens panel (Accessibility or UX & Layout). Both reuse the same
// group/occurrence/banding machinery; they differ only in their data + codes.
function lensPanel(lensId, data, codes, opts) {
  const showClean = opts.showClean, hasUx = opts.hasUx, label = opts.label;
  const dismissed = data.dismissedSet || new Set();
  const a = data.active;

  let pageList = Object.keys(data.pages).map((url) => {
    const issues = data.pages[url];
    return {
      url, issues,
      errs: issues.filter((i) => i.type === 'error' && !dismissed.has(i.fp)).length,
      act: issues.filter((i) => !dismissed.has(i.fp)).length,
    };
  });
  // The UX lens hides clean pages — clean is the norm there, so listing every
  // page would bury the findings. The a11y lens keeps them (clean is notable).
  if (!showClean) pageList = pageList.filter((p) => p.issues.length > 0);
  pageList.sort((p, q) => q.errs - p.errs || q.act - p.act);
  const sections = pageList.map((p) => pageSection(p, codes, dismissed)).join('\n');

  const newBadge = (!data.firstScan && data.summary.new) ? `<span class="pill new">⊕ ${data.summary.new} new since last scan</span>` : '';
  const resolvedBadge = (!data.firstScan && data.summary.resolved) ? `<span class="pill resolved">♻ ${data.summary.resolved} resolved</span>` : '';
  const errWord = lensId === 'ux' ? 'page error' : 'scan error';
  const scanErrBadge = data.summary.scanErrors ? `<span class="pill" title="Pages that failed to load/evaluate cleanly — not findings">⚠ ${data.summary.scanErrors} ${errWord}${data.summary.scanErrors === 1 ? '' : 's'}</span>` : '';

  const lensSwitch = hasUx ? `<div class="row lensrow"><div class="seg" role="group" aria-label="Report section">
<button class="btn${lensId === 'a11y' ? ' active' : ''}" data-lens-to="a11y">Accessibility</button>
<button class="btn${lensId === 'ux' ? ' active' : ''}" data-lens-to="ux">UX &amp; Layout</button>
</div></div>` : '';

  const empty = showClean ? 'No pages scanned.' : 'No UX / layout issues found 🎉';

  return `<section class="lens hide-dismissed" id="lens-${lensId}"${lensId === 'ux' ? ' hidden' : ''}>
<p class="meta lensmeta">${esc(label)} &middot; last scan ${esc(fmtDate(data.scannedAt))} &middot; ${data.summary.pages} page${data.summary.pages === 1 ? '' : 's'}</p>
<div class="sum">
<div class="err"><div class="n cErr">${a.errors}</div><div class="k">errors</div></div>
<div class="warn"><div class="n cWarn">${a.warnings}</div><div class="k">warnings</div></div>
<div class="notice"><div class="n cNotice">${a.notices}</div><div class="k">notices</div></div>
<div><div class="n">${data.summary.pages}</div><div class="k">pages</div></div>
<div><div class="n cDismissed">${a.dismissed}</div><div class="k">dismissed</div></div>
<div class="spacer"></div>${sparkline(data.history)}
</div>
<div class="badges">${newBadge}${resolvedBadge}${scanErrBadge}<span class="pill fixsum fixSummary"></span></div>

<div class="controls">
${lensSwitch}<div class="row">
<div class="seg" role="group" aria-label="View">
<button class="btn active" data-view="page">By page</button>
<button class="btn" data-view="issue">By issue type</button>
</div>
<button class="chip error on" data-sev="error">errors</button>
<button class="chip warning on" data-sev="warning">warnings</button>
<button class="chip notice on" data-sev="notice">notices</button>
<input class="q" type="search" placeholder="Search issues…" aria-label="Search issues">
<label class="ck"><input type="checkbox" class="showDismissed"> show dismissed</label>
<button class="btn exportBtn" title="Download the dismissed list to commit">Export dismissed</button>
</div>
</div>

<div class="byPage">
${sections || '<p class="muted">' + empty + '</p>'}
</div>

<div class="byIssue" hidden><div class="byIssueBody"></div></div>
</section>`;
}

// Re-derive a stored code table into render-time display metadata from the
// source-of-truth module, so a Rebuild picks up edits without a re-scan.
function a11yCodeTable(stored) {
  const codes = {};
  for (const k of Object.keys(stored || {})) {
    const v = stored[k];
    const m = wcag.forSC(v.sc);
    const f = wcag.fix(v.sc, k);
    codes[k] = { sc: v.sc, label: v.label, url: m.url || v.url, tip: m.tip || v.tip, why: m.why, method: f.method, lockedTip: f.lockedTip };
  }
  return codes;
}
function uxCodeTable(stored) {
  const codes = {};
  for (const k of Object.keys(stored || {})) {
    const c = uxChecks.forCheck(k);
    codes[k] = { sc: c.sc, label: c.label, url: c.url, tip: c.tip, why: c.why, method: c.method, lockedTip: c.lockedTip };
  }
  return codes;
}

function site(s) {
  const hasUx = !!(s.ux && s.ux.pages);
  const a11yCodes = a11yCodeTable(s.codes);
  const uxCodes = hasUx ? uxCodeTable(s.ux.codes) : {};

  const a11yPanel = lensPanel('a11y', s, a11yCodes, { showClean: true, hasUx, label: 'Accessibility' });
  const uxPanel = hasUx ? lensPanel('ux', s.ux, uxCodes, { showClean: false, hasUx, label: 'UX & Layout' }) : '';

  const report = {
    a11y: { slug: s.slug, storageKey: 'a11y-dismiss-' + s.slug, dismissFile: 'dismissed.json',
      baked: [...(s.dismissedSet || new Set())], codes: a11yCodes },
    ux: hasUx ? { slug: s.slug, storageKey: 'ux-dismiss-' + s.slug, dismissFile: 'ux-dismissed.json',
      baked: [...(s.ux.dismissedSet || new Set())], codes: uxCodes } : null,
  };

  const body = `<div class="row">
<a href="../../index.html" class="muted" style="text-decoration:none">← All sites</a>
<span class="spacer"></span>
<button class="btn" id="lockBtn" title="Locked theme: prioritize fixes you can do in CSS/JS. Click to switch to a customizable theme." aria-pressed="true">🔒 Locked theme</button>
<button class="btn" id="themeBtn" title="Toggle dark mode" aria-label="Toggle dark mode">◐</button></div>

<h1>${esc(s.name)}</h1>
<p class="meta">${esc(s.url)}</p>

${a11yPanel}
${uxPanel}

<script>window.__REPORT__=${jsonScript(report)};</script>
<script>${CLIENT_JS}</script>`;

  return shell(s.name + (hasUx ? ' — accessibility & UX report' : ' — accessibility report'), body);
}

// ---------------------------------------------------------------------------
// Client-side behavior (no backticks / no ${} so it embeds cleanly above)
// ---------------------------------------------------------------------------

const CLIENT_JS = `
(function(){
  var R = window.__REPORT__ || {};

  // ----- shared, stateless helpers (defined once) -----
  var MBADGE = {
    css:{badge:'CSS',fixable:true,label:'CSS'}, js:{badge:'JS',fixable:true,label:'JS'},
    markup:{badge:'Template',fixable:false,label:'template'}, content:{badge:'CMS',fixable:false,label:'CMS'}
  };
  function methodOf(m){ return MBADGE[m] || MBADGE.markup; }
  function lockedNow(){ return document.body.classList.contains('locked'); }
  function escapeHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function escapeAttr(s){ return escapeHtml(s).replace(/"/g,'&quot;'); }
  function fallbackCopy(text){
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand('copy'); } catch(e){}
    ta.remove();
  }
  function doCopy(text, btn){
    var label = btn.textContent;
    var ok = function(){ btn.textContent = 'Copied!'; setTimeout(function(){ btn.textContent = label; }, 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(ok, function(){ fallbackCopy(text); ok(); });
    } else { fallbackCopy(text); ok(); }
  }

  // ----- one report lens, every query scoped to its root element -----
  function initReport(root, cfg){
    var LS = cfg.storageKey;
    var baked = cfg.baked || [];
    var codes = cfg.codes || {};
    var bakedSet = {};
    baked.forEach(function(fp){ bakedSet[fp] = 1; });
    var lis = Array.prototype.slice.call(root.querySelectorAll('.issue'));
    var searchTerm = '';

    function store(){
      try { var v = JSON.parse(localStorage.getItem(LS)); if (v && v.added && v.removed) return v; } catch(e){}
      return {added:[], removed:[]};
    }
    function save(s){ try { localStorage.setItem(LS, JSON.stringify(s)); } catch(e){} }
    // Effective dismissed set = (committed baseline + locally added) - locally removed.
    function effective(){
      var s = store(), set = {};
      baked.forEach(function(fp){ set[fp] = 1; });
      s.added.forEach(function(fp){ set[fp] = 1; });
      s.removed.forEach(function(fp){ delete set[fp]; });
      return set;
    }
    function setText(cls,v){ var el=root.querySelector('.'+cls); if(el) el.textContent=v; }

    function applyState(){
      var eff = effective();
      lis.forEach(function(li){
        var dz = !!eff[li.getAttribute('data-fp')];
        li.classList.toggle('is-dismissed', dz);
        var cb = li.querySelector('.dismiss');
        if (cb) cb.checked = dz;
      });
      recompute();
    }

    function recompute(){
      var e=0,w=0,n=0,d=0;
      lis.forEach(function(li){
        if (li.classList.contains('is-dismissed')) { d++; return; }
        var t = li.getAttribute('data-type');
        if (t==='error') e++; else if (t==='warning') w++; else n++;
      });
      setText('cErr',e); setText('cWarn',w); setText('cNotice',n); setText('cDismissed',d);

      root.querySelectorAll('.grp').forEach(function(g){
        var act = g.querySelectorAll('.issue:not(.is-dismissed)').length;
        var cnt = g.querySelector('.cnt'); if (cnt) cnt.textContent = act + '\\u00d7';
        var occn = g.querySelector('.occn'); if (occn) occn.textContent = act;
        g.classList.toggle('empty', act===0);
      });
      root.querySelectorAll('.pg').forEach(function(sec){
        var act = sec.querySelectorAll('.issue:not(.is-dismissed)').length;
        var errs = sec.querySelectorAll('.issue.error:not(.is-dismissed)').length;
        var c = sec.querySelector('.pgcount'); if (c) c.textContent = errs + ' errors / ' + act + ' issues';
        sec.classList.toggle('clean', act===0);
      });
      buildByIssue();
      updateFixSummary();
    }

    function buildByIssue(){
      var host = root.querySelector('.byIssueBody');
      if (!host) return;
      var locked = lockedNow();
      var map = {};
      lis.forEach(function(li){
        if (li.classList.contains('is-dismissed')) return;
        var code = li.getAttribute('data-code');
        var sec = li.closest('.pg');
        var page = sec ? sec.getAttribute('data-page') : '';
        var rec = map[code] || (map[code] = {count:0, type:li.getAttribute('data-type'), pages:{}});
        rec.count++; if (page) rec.pages[page] = 1;
      });
      var rows = Object.keys(map).map(function(code){
        var r = map[code]; r.code = code;
        r.method = (codes[code] || {}).method || 'markup';
        r.fixable = methodOf(r.method).fixable;
        return r;
      });
      if (locked) rows.sort(function(a,b){ return (a.fixable===b.fixable) ? (b.count-a.count) : (a.fixable?-1:1); });
      else rows.sort(function(a,b){ return b.count - a.count; });

      var html = '', fixHdr = false, needHdr = false;
      rows.forEach(function(r){
        if (locked){
          if (r.fixable && !fixHdr){ html += '<div class="band band-fix">Fixable by you — CSS / JS</div>'; fixHdr = true; }
          if (!r.fixable && !needHdr){ html += '<div class="band band-need">Needs template / CMS access</div>'; needHdr = true; }
        }
        html += card(r, locked);
      });
      host.innerHTML = html || '<p class="muted">No active issues 🎉</p>';
      if (searchTerm) filterCards(searchTerm);
    }

    function card(r, locked){
      var meta = codes[r.code] || {};
      var title = meta.label || r.code;
      var ref = meta.sc ? 'WCAG ' + meta.sc : 'Reference';
      var M = methodOf(r.method);
      var tip;
      if (locked){
        tip = M.fixable
          ? '<div class="tip"><b>How to fix ('+M.badge+'):</b> '+escapeHtml(meta.lockedTip||meta.tip||'')+'</div>'
          : '<div class="tip"><b>Needs '+M.label+' access:</b> '+escapeHtml(meta.lockedTip||meta.tip||'')+'</div>';
      } else {
        tip = meta.tip ? '<div class="tip"><b>How to fix:</b> '+escapeHtml(meta.tip)+'</div>' : '';
      }
      var pages = Object.keys(r.pages);
      var plinks = pages.map(function(p){
        var label = p; try { label = new URL(p).pathname || p; } catch(e){}
        return '<a href="'+escapeAttr(p)+'" target="_blank" rel="noopener" title="'+escapeAttr(p)+'">'+escapeHtml(label)+'</a>';
      }).join(' ');
      return '<div class="icard '+r.type+'" data-code="'+escapeAttr(r.code)+'">'
        + '<div class="ic-head"><span class="dot '+r.type+'"></span>'
        + '<span class="mtag '+r.method+'">'+M.badge+'</span>'
        + '<strong>'+escapeHtml(title)+'</strong>'
        + '<span class="cnt">'+r.count+'\\u00d7</span>'
        + (meta.url ? '<a class="sc" href="'+escapeAttr(meta.url)+'" target="_blank" rel="noopener">'+ref+'</a>' : '')
        + '<span class="ghspacer"></span><button class="copy" type="button" title="Copy title + why for your report">copy</button></div>'
        + (meta.why ? '<div class="why"><b>Why it matters:</b> '+escapeHtml(meta.why)+'</div>' : '')
        + tip
        + '<div class="pages"><span class="lbl">Found on '+pages.length+' page'+(pages.length===1?'':'s')+':</span> '+plinks+'</div>'
        + '</div>';
    }

    function updateFixSummary(){
      var el = root.querySelector('.fixSummary');
      if (!el) return;
      var fix = 0, need = 0;
      lis.forEach(function(li){
        if (li.classList.contains('is-dismissed')) return;
        var m = (codes[li.getAttribute('data-code')] || {}).method || 'markup';
        if (m==='css' || m==='js') fix++; else need++;
      });
      el.textContent = (fix + need) ? ('▣ ' + fix + ' fixable via CSS/JS · ' + need + ' need template/CMS') : '';
    }

    function filterCards(term){
      root.querySelectorAll('.icard').forEach(function(c){
        var hit = !term || c.textContent.toLowerCase().indexOf(term) >= 0;
        c.classList.toggle('q-hide', !hit);
      });
    }

    // Report-ready text: "Title (WCAG x.y.z)\\nWhy it matters: ...".
    function copyText(code){
      var m = codes[code] || {};
      var title = m.label || code;
      if (m.sc) title += ' (WCAG ' + m.sc + ')';
      var out = [title];
      if (m.why) out.push('Why it matters: ' + m.why);
      return out.join('\\n');
    }

    // Delegated clicks within this lens: copy, copy-selector, dismiss-all.
    root.addEventListener('click', function(ev){
      var t = ev.target;
      if (!t || !t.closest) return;
      var cp = t.closest('.copy');
      if (cp){ var h = cp.closest('[data-code]'); doCopy(copyText(h ? h.getAttribute('data-code') : ''), cp); return; }
      var cs = t.closest('.copy-sel');
      if (cs){ var code = cs.parentElement.querySelector('code'); doCopy(code ? code.textContent : '', cs); return; }
      var dg = t.closest('.dismiss-group');
      if (dg){
        var grp = dg.closest('.grp'); if (!grp) return;
        var items = Array.prototype.slice.call(grp.querySelectorAll('.issue'));
        var eff = effective();
        var allOff = items.every(function(li){ return eff[li.getAttribute('data-fp')]; });
        var s = store(), added = {}, removed = {};
        s.added.forEach(function(x){ added[x]=1; }); s.removed.forEach(function(x){ removed[x]=1; });
        items.forEach(function(li){
          var fp = li.getAttribute('data-fp');
          if (allOff){ if (bakedSet[fp]) removed[fp]=1; else delete added[fp]; }
          else { if (bakedSet[fp]) delete removed[fp]; else added[fp]=1; }
        });
        save({added:Object.keys(added), removed:Object.keys(removed)});
        applyState();
      }
    });

    // Per-occurrence dismiss checkbox.
    lis.forEach(function(li){
      var cb = li.querySelector('.dismiss');
      if (!cb) return;
      cb.addEventListener('change', function(){
        var fp = li.getAttribute('data-fp');
        var s = store(), added = {}, removed = {};
        s.added.forEach(function(x){ added[x]=1; });
        s.removed.forEach(function(x){ removed[x]=1; });
        if (cb.checked){ if (bakedSet[fp]) delete removed[fp]; else added[fp]=1; }
        else { if (bakedSet[fp]) removed[fp]=1; else delete added[fp]; }
        save({added:Object.keys(added), removed:Object.keys(removed)});
        applyState();
      });
    });

    root.querySelectorAll('[data-view]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var v = btn.getAttribute('data-view');
        root.querySelectorAll('[data-view]').forEach(function(b){ b.classList.toggle('active', b===btn); });
        root.querySelector('.byPage').hidden = (v!=='page');
        root.querySelector('.byIssue').hidden = (v!=='issue');
      });
    });

    root.querySelectorAll('[data-sev]').forEach(function(btn){
      btn.addEventListener('click', function(){
        btn.classList.toggle('on');
        root.classList.toggle('hide-' + btn.getAttribute('data-sev'), !btn.classList.contains('on'));
      });
    });

    var q = root.querySelector('.q');
    if (q) q.addEventListener('input', function(){
      searchTerm = q.value.trim().toLowerCase();
      root.querySelectorAll('.grp').forEach(function(g){
        g.classList.toggle('q-hide', !(!searchTerm || g.textContent.toLowerCase().indexOf(searchTerm) >= 0));
      });
      filterCards(searchTerm);
    });

    var sd = root.querySelector('.showDismissed');
    if (sd) sd.addEventListener('change', function(){
      root.classList.toggle('hide-dismissed', !sd.checked);
    });

    var ex = root.querySelector('.exportBtn');
    if (ex) ex.addEventListener('click', function(){
      var eff = effective(), obj = {}, today = new Date().toISOString().slice(0,10);
      Object.keys(eff).forEach(function(fp){ obj[fp] = {date: today}; });
      var blob = new Blob([JSON.stringify(obj, null, 2) + '\\n'], {type:'application/json'});
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = cfg.dismissFile;
      document.body.appendChild(a); a.click();
      setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 0);
    });

    applyState();
    return { recompute: recompute };
  }

  // ----- instantiate each present lens -----
  var apis = [];
  ['a11y','ux'].forEach(function(key){
    var root = document.getElementById('lens-' + key);
    if (root && R[key]) apis.push(initReport(root, R[key]));
  });
  var slug = (R.a11y && R.a11y.slug) || 'site';

  // ----- global: lens switch -----
  var lensBtns = Array.prototype.slice.call(document.querySelectorAll('[data-lens-to]'));
  function showLens(to){
    var a = document.getElementById('lens-a11y'), u = document.getElementById('lens-ux');
    if (a) a.hidden = (to!=='a11y');
    if (u) u.hidden = (to!=='ux');
    lensBtns.forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-lens-to')===to); });
  }
  if (lensBtns.length){
    var LENS = 'a11y-lens-' + slug;
    lensBtns.forEach(function(b){ b.addEventListener('click', function(){
      var to = b.getAttribute('data-lens-to'); showLens(to);
      try { localStorage.setItem(LENS, to); } catch(e){}
    }); });
    var saved; try { saved = localStorage.getItem(LENS); } catch(e){}
    if (saved==='ux' && document.getElementById('lens-ux')) showLens('ux');
  }

  // ----- global: dark mode -----
  var tb = document.getElementById('themeBtn');
  if (tb) tb.addEventListener('click', function(){
    var c = document.documentElement.getAttribute('data-theme');
    var nx = c==='dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nx);
    try { localStorage.setItem('a11y-theme', nx); } catch(e){}
  });

  // ----- global: locked-theme mode (shared across both lenses) -----
  var LK = 'a11y-locked-' + slug;
  function setLockLabel(locked){
    var b = document.getElementById('lockBtn');
    if (b){ b.textContent = locked ? '🔒 Locked theme' : '🔓 Customizable'; b.setAttribute('aria-pressed', locked ? 'true' : 'false'); }
  }
  function initLock(){
    var locked; try { var v = localStorage.getItem(LK); locked = (v===null) ? true : (v==='1'); } catch(e){ locked = true; }
    document.body.classList.toggle('locked', locked);
    setLockLabel(locked);
  }
  var lb = document.getElementById('lockBtn');
  if (lb) lb.addEventListener('click', function(){
    var locked = !lockedNow();
    document.body.classList.toggle('locked', locked);
    try { localStorage.setItem(LK, locked ? '1' : '0'); } catch(e){}
    setLockLabel(locked);
    apis.forEach(function(a){ a.recompute(); });
  });

  initLock();
})();
`;

module.exports = { landing, site };
