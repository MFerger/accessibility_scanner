# a11y-scanner

Enter a site URL, scan every post and page in its sitemap for **WCAG 2.2 AA**
issues (plus a second **UX / layout** lens), and publish a static report to
GitHub Pages. Scan data is committed back to the repo, so every report is
reproducible and history is tracked over time.

## How it runs (GitHub Actions)

Run the **Accessibility scan** workflow from the Actions tab and enter the
client's site URL. It:

1. **Discovers** page URLs from the site's sitemap (`sitemap_index.xml`,
   `wp-sitemap.xml`, or `sitemap.xml` — Yoast/RankMath and gzipped `.xml.gz`
   sitemaps and nested sitemap indexes are all handled).
2. **Scans** each page with `pa11y-ci` (axe + HTML_CodeSniffer).
3. **Ingests** the raw results into a slim, committed record under
   `data/<slug>/`.
4. Optionally runs the **UX / layout** scan (rendering + mobile-friendliness).
5. Optionally **screenshots** each flagged element (see below).
6. **Builds** the static HTML reports into `build/` and deploys to Pages.

Workflow inputs: `url`, `name` (display name), `types` (sitemap types, default
`post,page`), `single` (scan only the one URL — see below), `ux` (run the UX
lens, default on), `shots` (capture element screenshots, default on) and
`shot_max` (screenshot budget, default 400).

**Rebuild report** is a separate workflow that regenerates the HTML from the
already-committed scan data (no re-scan) — use it to pick up report/wording
changes or newly-committed dismissals.

## Running locally

```sh
npm install
SCAN_URL=https://clientsite.com npm run build   # discover → scan → ingest → ux → report
open build/index.html
```

Individual steps are also available: `npm run discover`, `scan`, `ingest`,
`scan:ux`, `ingest:ux`, `shots`, `report`.

### Scanning a single page

To re-check one page ("is this fixed now?") without crawling the whole sitemap,
set `SINGLE=1` (or tick the **single** box in the workflow):

```sh
SINGLE=1 SCAN_URL=https://clientsite.com/some-page npm run discover
npm run scan && npm run ingest && npm run report
```

The result is ingested into the **same** `data/<slug>/` record as a full scan,
so it refreshes only that one page's issues — it is not a full re-scan of the
site.

## Element screenshots

Every report can show a small picture of the thing it is complaining about. It
is a **crop of the flagged element** — the element plus ~24px of surrounding
context, ringed in red — not a full-page shot, so you can see at a glance which
button, link or paragraph is at fault:

```sh
SCAN_URL=https://clientsite.com npm run shots   # after ingest, before report
```

`scripts/shoot.js` is driven by the already-ingested findings, so it revisits
each page once and photographs exactly the elements that were flagged (a11y
findings at pa11y's 1280×1024 viewport, UX findings at the viewport they were
found at). Elements it can't photograph — off-canvas skip links, `display:none`
nodes, console errors, elements that vanished since the scan — are skipped and
simply render without a picture.

**One shot per element, not per occurrence.** Shots are keyed the same way the
report groups site-wide issues, so a flagged nav link that appears on 40 pages
is one image reused 40 times. That is what keeps this cheap.

### Storage

Images are committed to `data/<slug>/shots/` (with a `shots.json` manifest)
alongside the scan data, so a **Rebuild report** still has them and every report
stays reproducible from the repo alone. Real numbers from a 58-page client site:

| | |
|---|---|
| Distinct flagged elements | ~580 (from ~2,600 occurrences) |
| Average image | ~5 KB (WebP, quality 70, ≤640×400) |
| Cost at the default 400 cap | **~2 MB per site, per scan** |

Two things keep that from compounding:

* **Re-scans don't re-shoot.** An element whose image is already on disk is
  carried straight into the new manifest, so an unchanged site costs nothing —
  no re-shooting, no rewritten bytes, no git churn.
* **Stale images are pruned.** Each run deletes images no current finding points
  at, so the working tree tracks the latest scan. (Git *history* still holds
  every version ever committed — that is the one cost you can't undo without
  rewriting history.)

### Time, and finishing an interrupted run

The pass is bounded so pictures can never hold up a scan: it stops after
`shot_budget_min` (default **6 minutes**), keeps everything it captured, and
lets the report deploy. A typical 30-page site finishes in well under a minute.

Because a re-run reuses what is already on disk, **running the scan again picks
up exactly where the last one left off** — it spends the whole budget on the
pictures that are still missing. So a big site can be filled in over two runs,
or in one by raising **shot_budget_min**. (The workflow step is killed at 20
minutes regardless; raise `timeout-minutes` in `scan.yml` if you go past ~18.)

Since keys are derived from an element's markup, changing an element gives it a
new key and a fresh picture. A change that alters only *appearance* (CSS) and
not markup keeps the old image — set `SHOT_REFRESH=1` to retake everything.

Other knobs: `SHOT_MAX` (how many elements to cover — errors first, then the
elements repeated on the most pages; `0` means no cap), `SHOT_QUALITY`,
`SHOT_PAD`, `SHOT_MAX_W` / `SHOT_MAX_H`. Turn it off entirely by unticking
**shots** in the workflow. Trimming the committed images later is just
`rm -rf data/<slug>/shots data/<slug>/shots.json` plus a rebuild.

> **Note:** if you password-protect the report with `REPORT_PASSWORD`,
> staticrypt encrypts the HTML but **not** the `shots/*.webp` files — they stay
> readable to anyone who guesses their URL. The report is `noindex` and
> `robots.txt`-disallowed, but don't treat the images as secret.

## Dismissing issues

Issues you've fixed or judged to be false positives can be dismissed so they
drop out of the active counts. Dismissals are made in the report UI but must be
committed to `data/` to persist across rebuilds:

1. In a report, mark issues **resolved** (checkbox) or flag them as a
   **false positive** (⚑).
2. Click **Export dismissed** — this downloads `dismissed.json` (or
   `ux-dismissed.json` for the UX lens) containing the full dismissed set.
3. Apply it to the committed data with the helper:

   ```sh
   npm run apply-dismissed -- <slug> ~/Downloads/dismissed.json
   # UX lens:
   npm run apply-dismissed -- <slug> ~/Downloads/ux-dismissed.json --ux
   ```

   The helper validates the file, writes it to `data/<slug>/`, and warns about
   any fingerprints no longer present in the latest scan.
4. Commit the `data/` change and run the **Rebuild report** workflow (or
   `npm run report` locally).

`<slug>` is the folder name under `data/` (hostname with `www.` dropped, e.g.
`clientsite-com`).

## Tests

```sh
npm test            # fast, browser-free: fingerprint grouping + WCAG tables
npm run test:ux     # UX scanner against HTML fixtures (needs Chromium + python3)
npm run test:shots  # element screenshots, checked by decoding the pixels
npm run test:sitewide  # report interactivity (needs Chromium)
```

`npm test` runs in CI (`.github/workflows/ci.yml`) on every push and pull
request.
