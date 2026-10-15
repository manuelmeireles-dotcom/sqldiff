/*
 * SQL Diff core — pure functions shared by the browser UI and the Node tests.
 * Browser: loaded after vendor/diff.min.js and vendor/sql-formatter.min.js, exposes window.SqlDiffCore.
 * Node:    require('./diff-core.js').
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./vendor/diff.min.js'), require('./vendor/sql-formatter.min.js'));
  } else {
    root.SqlDiffCore = factory(root.Diff, root.sqlFormatter);
  }
})(typeof self !== 'undefined' ? self : this, function (Diff, sqlFormatter) {
  'use strict';

  // Airflow templating: {{ ... }}, {% ... %}, {# ... #}
  const JINJA_REGEX = String.raw`\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}`;

  /** Unify line endings and make a non-empty text end with exactly one "\n" terminator. */
  function normalizeText(text) {
    let t = (text || '').replace(/\r\n?/g, '\n');
    if (t !== '' && !t.endsWith('\n')) t += '\n';
    return t;
  }

  function splitLines(text) {
    if (text === '') return [];
    const lines = text.split('\n');
    lines.pop(); // trailing "" after the final "\n"
    return lines;
  }

  /**
   * Format SQL with sql-formatter, keeping Jinja blocks intact.
   * Returns { text, error } — on failure text is the input unchanged.
   */
  function formatSql(text, language) {
    if (!text.trim()) return { text, error: null };
    try {
      const out = sqlFormatter.format(text, {
        language: language || 'sql',
        keywordCase: 'upper',
        tabWidth: 2,
        paramTypes: { custom: [{ regex: JINJA_REGEX }] },
      });
      return { text: out, error: null };
    } catch (e) {
      return { text, error: e && e.message ? e.message : String(e) };
    }
  }

  /**
   * Line diff of two texts.
   * Returns { lines, hunks, oldLines, newLines, oldText, newText } where every entry of
   * `lines` is { type: 'equal'|'deleted'|'inserted', oldNo, newNo, hunk } (1-based numbers, null when absent).
   */
  function computeDiff(oldRaw, newRaw, opts) {
    opts = opts || {};
    const oldText = normalizeText(oldRaw);
    const newText = normalizeText(newRaw);
    const oldLines = splitLines(oldText);
    const newLines = splitLines(newText);

    // Ignore whitespace: diff canonical lines (trimmed, inner runs collapsed). The line count per side
    // is unchanged, so line numbers still point at the original text.
    const canon = (ls) => ls.map((l) => l.trim().replace(/\s+/g, ' ') + '\n').join('');
    const changes = opts.ignoreWhitespace
      ? Diff.diffLines(canon(oldLines), canon(newLines))
      : Diff.diffLines(oldText, newText);

    const lines = [];
    let oldNo = 1;
    let newNo = 1;
    for (const ch of changes) {
      const n = ch.count != null ? ch.count : splitLines(normalizeText(ch.value)).length;
      for (let i = 0; i < n; i++) {
        if (ch.added) lines.push({ type: 'inserted', oldNo: null, newNo: newNo++, hunk: null });
        else if (ch.removed) lines.push({ type: 'deleted', oldNo: oldNo++, newNo: null, hunk: null });
        else lines.push({ type: 'equal', oldNo: oldNo++, newNo: newNo++, hunk: null });
      }
    }

    // Group consecutive changed lines into hunks.
    const hunks = [];
    let cur = null;
    let lastOld = 0; // last original line number seen (for pure insertions: "after line X")
    let lastNew = 0;
    lines.forEach((l, idx) => {
      if (l.type === 'equal') {
        cur = null;
        lastOld = l.oldNo;
        lastNew = l.newNo;
        return;
      }
      if (!cur) {
        cur = {
          index: hunks.length + 1,
          firstLine: idx,
          oldStart: null, oldEnd: null, newStart: null, newEnd: null,
          afterOld: lastOld, afterNew: lastNew,
          deleted: 0, inserted: 0,
        };
        hunks.push(cur);
      }
      l.hunk = cur.index;
      if (l.type === 'deleted') {
        cur.deleted++;
        if (cur.oldStart === null) cur.oldStart = l.oldNo;
        cur.oldEnd = l.oldNo;
        lastOld = l.oldNo;
      } else {
        cur.inserted++;
        if (cur.newStart === null) cur.newStart = l.newNo;
        cur.newEnd = l.newNo;
        lastNew = l.newNo;
      }
    });

    return { lines, hunks, oldLines, newLines, oldText, newText };
  }

  /** [12, 14, 15, 16, 40] -> "12, 14–16, 40" */
  function compressRanges(nums) {
    const parts = [];
    let i = 0;
    while (i < nums.length) {
      let j = i;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      parts.push(i === j ? String(nums[i]) : nums[i] + '–' + nums[j]);
      i = j + 1;
    }
    return parts.join(', ');
  }

  function hunkOldRange(h) {
    if (h.deleted === 0) return 'after ' + h.afterOld;
    return h.oldStart === h.oldEnd ? String(h.oldStart) : h.oldStart + '–' + h.oldEnd;
  }

  function hunkNewRange(h) {
    if (h.inserted === 0) return 'after ' + h.afterNew;
    return h.newStart === h.newEnd ? String(h.newStart) : h.newStart + '–' + h.newEnd;
  }

  function summarize(result) {
    const deletedLines = [];
    const insertedLines = [];
    let unchanged = 0;
    for (const l of result.lines) {
      if (l.type === 'deleted') deletedLines.push(l.oldNo);
      else if (l.type === 'inserted') insertedLines.push(l.newNo);
      else unchanged++;
    }
    return {
      deleted: deletedLines.length,
      inserted: insertedLines.length,
      unchanged,
      hunkCount: result.hunks.length,
      oldTotal: result.oldLines.length,
      newTotal: result.newLines.length,
      deletedLines,
      insertedLines,
      deletedRanges: compressRanges(deletedLines),
      insertedRanges: compressRanges(insertedLines),
      hunks: result.hunks.map((h) => ({
        index: h.index,
        oldRange: hunkOldRange(h),
        newRange: hunkNewRange(h),
        deleted: h.deleted,
        inserted: h.inserted,
      })),
    };
  }

  /** Markdown block for a PR description / commit message. */
  function toMarkdown(summary, meta) {
    meta = meta || {};
    const oldName = meta.oldName || 'original.sql';
    const newName = meta.newName || 'new.sql';
    const out = [];
    out.push('### SQL diff: `' + oldName + '` → `' + newName + '`');
    if (meta.normalized) out.push('_Compared after SQL formatting — line numbers refer to the formatted text._');
    if (meta.ignoreWhitespace) out.push('_Whitespace-only changes ignored._');
    out.push('');
    out.push('| | Lines |');
    out.push('|---|---|');
    out.push('| Deleted (from original) | **' + summary.deleted + '** |');
    out.push('| Inserted (in new) | **' + summary.inserted + '** |');
    out.push('| Unchanged | ' + summary.unchanged + ' |');
    out.push('| Total | ' + summary.oldTotal + ' → ' + summary.newTotal + ' |');
    out.push('');
    out.push('- Deleted line numbers (original): ' + (summary.deletedRanges || '—'));
    out.push('- Inserted line numbers (new): ' + (summary.insertedRanges || '—'));
    if (summary.hunks.length) {
      out.push('');
      out.push('| Change | Original lines | New lines | − | + |');
      out.push('|---|---|---|---|---|');
      for (const h of summary.hunks) {
        out.push('| ' + h.index + ' | ' + h.oldRange + ' | ' + h.newRange + ' | ' + h.deleted + ' | ' + h.inserted + ' |');
      }
    }
    return out.join('\n');
  }

  function unifiedPatch(result, oldName, newName) {
    return Diff.createTwoFilesPatch(oldName || 'original.sql', newName || 'new.sql', result.oldText, result.newText);
  }

  /** Word-level diff for one paired (deleted, inserted) row. */
  function wordDiff(oldLine, newLine) {
    return Diff.diffWordsWithSpace(oldLine, newLine);
  }

  return {
    normalizeText,
    formatSql,
    computeDiff,
    compressRanges,
    summarize,
    toMarkdown,
    unifiedPatch,
    wordDiff,
  };
});
