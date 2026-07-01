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
5. **Builds** the static HTML reports into `build/` and deploys to Pages.

Workflow inputs: `url`, `name` (display name), `types` (sitemap types, default
`post,page`), `single` (scan only the one URL — see below), and `ux` (run the
UX lens, default on).

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
`scan:ux`, `ingest:ux`, `report`.

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
npm run test:sitewide  # report interactivity (needs Chromium)
```

`npm test` runs in CI (`.github/workflows/ci.yml`) on every push and pull
request.
