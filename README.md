# SQL Diff

Static page for comparing two versions of an Airflow SQL file. Besides the side-by-side diff it reports
**how many lines were deleted (from the original) and inserted (in the new file), and their line numbers**.

## Install / open (macOS or Windows)
1. Copy or unzip the `sqldiff` folder anywhere (keep the files together — `vendor/` is required).
2. Double-click `index.html`. It opens in your default browser (Chrome, Edge, Firefox or Safari).
   - Windows: if it opens in another app, right-click `index.html` → **Open with** → Edge or Chrome.
3. Optional: bookmark the page in the browser.

No install, server or internet connection needed, and SQL you paste never leaves your machine.

## Share as a single file
Email filters often block `.js` files and zips that contain them. Build one self-contained page instead:
```sh
node build.mjs        # -> dist/sqldiff.html (everything inlined)
```
Send `dist/sqldiff.html`; the recipient saves it and double-clicks it. Rebuild after changing any source file.

## Use

- Paste SQL into **Original** / **New**, or drop / open `.sql` files.
- **Normalize SQL formatting** (off by default) — formats both sides with sql-formatter first so reformat-only
  edits disappear. Airflow Jinja (`{{ ds }}`, `{% if %}`, `{# #}`) is kept intact. Line numbers then refer to the
  formatted text.
- **Ignore whitespace** — indentation / spacing changes don't count.
- **Collapse unchanged lines** — keeps 3 lines of context around each change.
- Summary: deleted / inserted / unchanged counts, line ranges (e.g. `12, 14–18`), and a table of change blocks
  (click a row to jump to it).
- **Copy summary (Markdown)** for a PR description; **Copy unified diff** for a patch.

A modified line counts as 1 deleted + 1 inserted (same as `git diff --stat`).

## Files
- `diff-core.js` — pure diff/summary logic (browser + Node)
- `app.js`, `index.html`, `styles.css` — UI
- `vendor/` — jsdiff 5.2.0, sql-formatter 15.4.0 (vendored for offline use)

## Tests
```sh
node --test test/
```
