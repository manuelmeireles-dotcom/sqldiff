# SQL Diff

Static, offline browser tool for comparing two versions of an Airflow SQL file. Its key feature, beyond a normal
diff view, is reporting **how many lines were deleted (original) and inserted (new), with their line numbers**.

## Hard constraints
- **No server, no build step needed to run.** Must open by double-clicking `index.html` (`file://`) on macOS and
  Windows in Chrome / Edge / Firefox / Safari, with no internet.
  - Use plain `<script src>` tags (UMD globals). Don't use ES modules, `fetch()` of local files or CDN URLs:
    they break under `file://` or offline.
  - Wrap `localStorage` and clipboard access in try/catch (`copyText()` in `app.js` falls back to `execCommand`).
- **Distributed as one file:** `node build.mjs` → `dist/sqldiff.html` (everything inlined, ~281 KB). Email blocks
  `.js` and zips containing them, so this single file is how it gets shared. Rebuild after any source change.
  New assets must be referenced as `<link rel="stylesheet" href>` / `<script src>` so `build.mjs` can inline them;
  it throws if an external reference is left.
- SQL never leaves the browser. Don't add telemetry or network calls.

## Layout
- `diff-core.js` — pure logic, UMD (browser global `SqlDiffCore`, Node `require`). Key fns: `computeDiff`,
  `summarize`, `compressRanges`, `toMarkdown`, `formatSql`, `unifiedPatch`, `wordDiff`.
- `app.js` — UI wiring: debounced compute (250 ms), `buildRows` / `visibility` (collapse, 3 lines context) /
  `renderDiff` (one innerHTML string), hunk navigation, theme toggle.
- `index.html`, `styles.css` — CSS tokens on `:root`; dark palette under `:root[data-theme="dark"]` and
  `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`. Theme saved in `localStorage` key
  `sqldiff-theme`, applied by an inline head script before first paint.
- `vendor/` — jsdiff 5.2.0 (`diff.min.js`, global `Diff`), sql-formatter 15.4.0 (global `sqlFormatter`). Vendored
  from `npm pack`; don't switch to CDNs.
- `test/diff-core.test.mjs` — `node --test test/`.

## Semantics (keep consistent)
- A modified line = 1 deleted + 1 inserted (like `git diff --stat`). Verify counts against
  `diff -u a.sql b.sql | grep -cE '^-[^-]'` / `'^\+[^+]'`.
- Line endings are normalized (CRLF→LF) and a missing final newline doesn't count as a change.
- Ignore-whitespace is implemented by diffing canonical lines (trim + collapse inner runs), **not** jsdiff's
  `ignoreWhitespace` (that only trims). Line counts stay 1:1, so numbers still map to the original text.
- Normalize runs sql-formatter (keywordCase upper) with Jinja `{{ }}` / `{% %}` / `{# #}` protected via
  `paramTypes.custom`. Line numbers then refer to the formatted text (shown in a banner). If formatting fails, it
  falls back to raw text with a warning.

## Possible optimizations (not done)
- Very large files: `renderDiff` builds the full DOM. Virtualize rows if files > ~20k lines get slow.
- Word-diff is skipped for lines > 600 chars (`WORD_DIFF_MAX`).
- `dist/sqldiff.html` is dominated by sql-formatter (~236 KB). A dialect-specific build could shrink it.

## Verify UI changes
Headless Chrome screenshot (min viewport is 500px in headless):
`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --allow-file-access-from-files --window-size=1300,900 --screenshot=out.png file:///path/to/page.html`
Prefill the textareas with an inline script in a scratch copy of the page to get a populated render.
