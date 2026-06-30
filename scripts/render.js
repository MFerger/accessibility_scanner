'use strict';

/*
 * HTML rendering for the accessibility reports. Everything is a single
 * self-contained HTML file per page — inline CSS, inline vanilla JS, no build
 * step and no runtime dependencies. Two exports:
 *
 *   landing(sites)  -> the homepage listing every scanned site
 *   site(site)      -> one interactive per-site report
 */

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// JSON that is safe to drop inside a <script> tag (no </script> break-out).
const jsonScript = (obj) => JSON.stringify(obj)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

const fmtDate = (iso) => String(iso || '').slice(0, 10) || '—';

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
body{font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;max-width:960px;margin:0 auto;
  padding:24px 20px 64px;color:var(--fg);background:var(--bg);-webkit-text-size-adjust:100%}
a{color:var(--accent)}
h1{margin:0 0 4px;font-size:24px}
.meta{color:var(--muted);margin:0 0 20px;font-size:13px;word-break:break-all}
.muted{color:var(--muted)}
.row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.spacer{flex:1 1 auto}

/* summary numbers */
.sum{display:flex;gap:22px;flex-wrap:wrap;margin:14px 0 6px}
.sum .n{font-size:26px;font-weight:700;line-height:1}
.sum .k{font-size:12px;color:var(--muted)}
.sum .err .n{color:var(--err)} .sum .warn .n{color:var(--warn)} .sum .notice .n{color:var(--notice)}
.badges{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 0}
.pill{font-size:12px;padding:2px 9px;border-radius:999px;background:var(--chip);color:var(--fg)}
.pill.new{background:rgba(37,99,235,.12);color:var(--accent)}
.pill.resolved{background:rgba(42,122,58,.14);color:var(--ok)}
.spark{color:var(--accent);vertical-align:middle}

/* controls */
.controls{position:sticky;top:0;z-index:5;background:var(--bg);padding:10px 0;margin:8px 0 14px;
  border-bottom:1px solid var(--border)}
.controls button,.controls input,.controls label{font:inherit}
.btn{border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:7px;
  padding:5px 11px;cursor:pointer}
.btn.active{background:var(--accent);border-color:var(--accent);color:#fff}
.seg{display:inline-flex;border:1px solid var(--border);border-radius:7px;overflow:hidden}
.seg .btn{border:0;border-radius:0}
.chip{border:1px solid var(--border);background:var(--card);color:var(--muted);border-radius:999px;
  padding:4px 11px;cursor:pointer}
.chip.on{color:var(--fg)}
.chip.error.on{border-color:var(--err);color:var(--err)}
.chip.warning.on{border-color:var(--warn);color:var(--warn)}
.chip.notice.on{border-color:var(--notice);color:var(--notice)}
#q{border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:7px;
  padding:6px 10px;min-width:170px;flex:1 1 170px}
.ck{display:inline-flex;gap:6px;align-items:center;color:var(--muted);cursor:pointer;font-size:13px}

/* page sections */
.pg{border:1px solid var(--border);border-radius:10px;padding:12px 16px;margin:0 0 12px;
  background:var(--card);box-shadow:var(--shadow)}
.pg.clean{opacity:.7}
.pg h2{font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  word-break:break-all;margin:0 0 6px;font-weight:600}
.pg h2 .pgcount{color:var(--muted);font-weight:400;font-family:system-ui,sans-serif;font-size:12px}
ul.issues{list-style:none;margin:0;padding:0}
.issue{display:flex;gap:10px;border-top:1px solid var(--line);padding:11px 0}
.issue:first-child{border-top:0}
.issue .body{min-width:0;flex:1}
.issue .head{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin:0 0 3px}
.t{font-size:10.5px;text-transform:uppercase;font-weight:700;padding:1px 6px;border-radius:4px;color:#fff}
.t.error{background:var(--err)} .t.warning{background:var(--warn)} .t.notice{background:var(--notice)}
.imp{font-size:10.5px;text-transform:uppercase;letter-spacing:.02em;color:var(--muted);
  border:1px solid var(--border);border-radius:4px;padding:0 5px}
.sc{font-size:12px;white-space:nowrap}
.msg{font-size:14px}
.tip{font-size:12.5px;color:var(--muted);margin:3px 0 0}
.sel{margin:5px 0 0;font-size:12.5px}
.sel code,pre code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.issue pre{background:var(--code);color:var(--codefg);padding:8px 10px;border-radius:6px;
  overflow:auto;font-size:12px;margin:6px 0 0}
.dz{flex:0 0 auto;padding-top:2px}
.dz input{width:16px;height:16px;cursor:pointer}
.issue.is-dismissed .body{opacity:.5}
.issue.is-dismissed .msg{text-decoration:line-through}

/* by-issue table */
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:9px 12px;border-top:1px solid var(--line);vertical-align:top}
thead th{border-top:0;font-size:12px;color:var(--muted);font-weight:600}
td.num,th.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
td.ic{width:14px;padding-right:0}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%}
.dot.error{background:var(--err)} .dot.warning{background:var(--warn)} .dot.notice{background:var(--notice)}
td.lbl .tip{margin-top:2px}

/* landing cards */
.cards{display:grid;gap:12px}
.card{display:block;border:1px solid var(--border);border-radius:12px;padding:16px;background:var(--card);
  text-decoration:none;color:inherit;box-shadow:var(--shadow)}
.card:hover{border-color:var(--accent)}
.card .name{font-size:17px;font-weight:600;margin:0}
.card .host{color:var(--muted);font-size:13px;word-break:break-all}
.card .stats{display:flex;gap:18px;align-items:center;margin-top:10px;flex-wrap:wrap}
.card .stat b{font-size:20px} .card .stat span{font-size:12px;color:var(--muted);margin-left:4px}

/* filter visibility (combined via body classes) */
body.hide-error .issue.error,body.hide-warning .issue.warning,body.hide-notice .issue.notice{display:none}
body.hide-error #byIssue tr.error,body.hide-warning #byIssue tr.warning,body.hide-notice #byIssue tr.notice{display:none}
body.hide-dismissed .issue.is-dismissed{display:none}
.issue.q-hide{display:none}
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
</head><body class="hide-dismissed">
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
    <span class="stat err"><b style="color:var(--err)">${a.errors}</b><span>errors</span></span>
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

function issueLi(it, codes) {
  const meta = codes[it.code] || {};
  const ref = meta.sc ? 'WCAG ' + meta.sc : 'Reference';
  return `<li class="issue ${esc(it.type)}" data-fp="${esc(it.fp)}" data-code="${esc(it.code)}" data-type="${esc(it.type)}" data-impact="${esc(it.impact || '')}">
<label class="dz"><input type="checkbox" class="dismiss" aria-label="Dismiss this issue"></label>
<div class="body">
<div class="head"><span class="t ${esc(it.type)}">${esc(it.type)}</span>${it.impact ? '<span class="imp">' + esc(it.impact) + '</span>' : ''}${meta.url ? '<a class="sc" href="' + esc(meta.url) + '" target="_blank" rel="noopener">' + esc(ref) + '</a>' : ''}</div>
<div class="msg">${esc(it.message)}</div>
${meta.tip ? '<div class="tip">' + esc(meta.tip) + '</div>' : ''}
${it.selector ? '<div class="sel"><code>' + esc(it.selector) + '</code></div>' : ''}
${it.context ? '<pre><code>' + esc(it.context) + '</code></pre>' : ''}
</div></li>`;
}

function site(s) {
  const codes = s.codes || {};
  const dismissed = s.dismissedSet || new Set();
  const a = s.active;

  // pages sorted by active error count desc, then active total desc
  const pageList = Object.keys(s.pages).map((url) => {
    const issues = s.pages[url];
    const errs = issues.filter((i) => i.type === 'error' && !dismissed.has(i.fp)).length;
    const act = issues.filter((i) => !dismissed.has(i.fp)).length;
    return { url, issues, errs, act };
  }).sort((p, q) => q.errs - p.errs || q.act - p.act);

  const sections = pageList.map((p) => {
    const items = p.issues.map((it) => issueLi(it, codes)).join('\n');
    return `<section class="pg${p.act === 0 ? ' clean' : ''}" data-page="${esc(p.url)}">
<h2>${esc(p.url)} <span class="pgcount">${p.errs} errors / ${p.act} issues</span></h2>
<ul class="issues">${items || '<li class="muted">No issues found.</li>'}</ul>
</section>`;
  }).join('\n');

  const bakedFps = jsonScript([...dismissed]);
  const codesJson = jsonScript(codes);

  const newBadge = (!s.firstScan && s.summary.new) ? `<span class="pill new">⊕ ${s.summary.new} new since last scan</span>` : '';
  const resolvedBadge = (!s.firstScan && s.summary.resolved) ? `<span class="pill resolved">♻ ${s.summary.resolved} resolved</span>` : '';
  const scanErrBadge = s.summary.scanErrors ? `<span class="pill" title="Pages that failed to evaluate cleanly (e.g. browser timeouts) — not accessibility issues">⚠ ${s.summary.scanErrors} scan error${s.summary.scanErrors === 1 ? '' : 's'}</span>` : '';
  const spark = sparkline(s.history);

  const body = `<div class="row">
<a href="../../index.html" class="muted" style="text-decoration:none">← All sites</a>
<span class="spacer"></span>
<button class="btn" id="themeBtn" title="Toggle dark mode" aria-label="Toggle dark mode">◐</button></div>

<h1>${esc(s.name)}</h1>
<p class="meta">${esc(s.url)} &middot; last scan ${esc(fmtDate(s.scannedAt))}</p>

<div class="sum">
<div class="err"><div class="n" id="cErr">${a.errors}</div><div class="k">errors</div></div>
<div class="warn"><div class="n" id="cWarn">${a.warnings}</div><div class="k">warnings</div></div>
<div class="notice"><div class="n" id="cNotice">${a.notices}</div><div class="k">notices</div></div>
<div><div class="n">${s.summary.pages}</div><div class="k">pages</div></div>
<div><div class="n" id="cDismissed">${a.dismissed}</div><div class="k">dismissed</div></div>
<div class="spacer"></div>${spark}
</div>
<div class="badges">${newBadge}${resolvedBadge}${scanErrBadge}</div>

<div class="controls">
<div class="row">
<div class="seg" role="group" aria-label="View">
<button class="btn active" data-view="page">By page</button>
<button class="btn" data-view="issue">By issue type</button>
</div>
<button class="chip error on" data-sev="error">errors</button>
<button class="chip warning on" data-sev="warning">warnings</button>
<button class="chip notice on" data-sev="notice">notices</button>
<input id="q" type="search" placeholder="Search issues…" aria-label="Search issues">
<label class="ck"><input type="checkbox" id="showDismissed"> show dismissed</label>
<button class="btn" id="exportBtn" title="Download dismissed.json to commit">Export dismissed</button>
</div>
</div>

<div id="byPage">
${sections || '<p class="muted">No pages scanned.</p>'}
</div>

<div id="byIssue" hidden>
<table>
<thead><tr><th class="ic"></th><th>Issue</th><th class="num">Count</th><th class="num">Pages</th><th>Ref</th></tr></thead>
<tbody id="issueBody"></tbody>
</table>
</div>

<script>window.__A11Y__={slug:${jsonScript(s.slug)},baked:${bakedFps},codes:${codesJson}};</script>
<script>${CLIENT_JS}</script>`;

  return shell(s.name + ' — accessibility report', body);
}

// ---------------------------------------------------------------------------
// Client-side behavior (no backticks / no ${} so it embeds cleanly above)
// ---------------------------------------------------------------------------

const CLIENT_JS = `
(function(){
  var cfg = window.__A11Y__ || {};
  var slug = cfg.slug || 'site';
  var baked = cfg.baked || [];
  var codes = cfg.codes || {};
  var LS = 'a11y-dismiss-' + slug;
  var bakedSet = {};
  baked.forEach(function(fp){ bakedSet[fp] = 1; });
  var lis = Array.prototype.slice.call(document.querySelectorAll('.issue'));

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

  function escapeHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function setText(id,v){ var el=document.getElementById(id); if(el) el.textContent=v; }

  function applyState(){
    var eff = effective();
    lis.forEach(function(li){
      var fp = li.getAttribute('data-fp');
      var dz = !!eff[fp];
      li.classList.toggle('is-dismissed', dz);
      var cb = li.querySelector('.dismiss');
      if (cb) cb.checked = dz;
    });
    recompute();
  }

  function recompute(){
    var e=0,w=0,n=0,d=0, byCode={};
    lis.forEach(function(li){
      if (li.classList.contains('is-dismissed')) { d++; return; }
      var type = li.getAttribute('data-type');
      if (type==='error') e++; else if (type==='warning') w++; else n++;
      var code = li.getAttribute('data-code');
      var sec = li.closest('.pg');
      var page = sec ? sec.getAttribute('data-page') : '';
      var rec = byCode[code] || (byCode[code] = {count:0, type:type, pages:{}});
      rec.count++; rec.pages[page] = 1;
    });
    setText('cErr', e); setText('cWarn', w); setText('cNotice', n); setText('cDismissed', d);
    document.querySelectorAll('.pg').forEach(function(sec){
      var act = sec.querySelectorAll('.issue:not(.is-dismissed)').length;
      var errs = sec.querySelectorAll('.issue.error:not(.is-dismissed)').length;
      var c = sec.querySelector('.pgcount');
      if (c) c.textContent = errs + ' errors / ' + act + ' issues';
      sec.classList.toggle('clean', act===0);
    });
    buildByIssue(byCode);
  }

  function buildByIssue(byCode){
    var body = document.getElementById('issueBody');
    if (!body) return;
    var rows = Object.keys(byCode).map(function(code){
      var r = byCode[code]; r.code = code; r.pageCount = Object.keys(r.pages).length; return r;
    }).sort(function(a,b){ return b.count - a.count; });
    var html = '';
    rows.forEach(function(r){
      var meta = codes[r.code] || {};
      var label = meta.label || r.code;
      var ref = meta.sc ? 'WCAG ' + meta.sc : 'Reference';
      html += '<tr class="' + r.type + '">'
        + '<td class="ic"><span class="dot ' + r.type + '"></span></td>'
        + '<td class="lbl"><div>' + escapeHtml(label) + '</div>'
        + (meta.tip ? '<div class="tip">' + escapeHtml(meta.tip) + '</div>' : '') + '</td>'
        + '<td class="num">' + r.count + '</td>'
        + '<td class="num">' + r.pageCount + '</td>'
        + '<td>' + (meta.url ? '<a href="' + escapeHtml(meta.url).replace(/"/g,'&quot;') + '" target="_blank" rel="noopener">' + ref + '</a>' : ref) + '</td>'
        + '</tr>';
    });
    body.innerHTML = html || '<tr><td colspan="5" class="muted">No active issues 🎉</td></tr>';
  }

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

  document.querySelectorAll('[data-view]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var v = btn.getAttribute('data-view');
      document.querySelectorAll('[data-view]').forEach(function(b){ b.classList.toggle('active', b===btn); });
      document.getElementById('byPage').hidden = (v!=='page');
      document.getElementById('byIssue').hidden = (v!=='issue');
    });
  });

  document.querySelectorAll('[data-sev]').forEach(function(btn){
    btn.addEventListener('click', function(){
      btn.classList.toggle('on');
      document.body.classList.toggle('hide-' + btn.getAttribute('data-sev'), !btn.classList.contains('on'));
    });
  });

  var q = document.getElementById('q');
  if (q) q.addEventListener('input', function(){
    var term = q.value.trim().toLowerCase();
    lis.forEach(function(li){
      var hit = !term || li.textContent.toLowerCase().indexOf(term) >= 0;
      li.classList.toggle('q-hide', !hit);
    });
  });

  var sd = document.getElementById('showDismissed');
  if (sd) sd.addEventListener('change', function(){
    document.body.classList.toggle('hide-dismissed', !sd.checked);
  });

  var tb = document.getElementById('themeBtn');
  if (tb) tb.addEventListener('click', function(){
    var c = document.documentElement.getAttribute('data-theme');
    var nx = c==='dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nx);
    try { localStorage.setItem('a11y-theme', nx); } catch(e){}
  });

  var ex = document.getElementById('exportBtn');
  if (ex) ex.addEventListener('click', function(){
    var eff = effective(), obj = {}, today = new Date().toISOString().slice(0,10);
    Object.keys(eff).forEach(function(fp){ obj[fp] = {date: today}; });
    var blob = new Blob([JSON.stringify(obj, null, 2) + '\\n'], {type:'application/json'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dismissed.json';
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 0);
  });

  applyState();
})();
`;

module.exports = { landing, site };
