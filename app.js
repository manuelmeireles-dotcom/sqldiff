/* SQL Diff — UI wiring. Depends on window.SqlDiffCore (diff-core.js). */
(function () {
  'use strict';

  const core = window.SqlDiffCore;
  const $ = (id) => document.getElementById(id);
  const CONTEXT = 3; // unchanged lines kept around each change when collapsing
  const WORD_DIFF_MAX = 600; // skip intra-line highlighting for very long lines

  const els = {
    oldText: $('old-text'), newText: $('new-text'),
    oldName: $('old-name'), newName: $('new-name'),
    oldFile: $('old-file'), newFile: $('new-file'),
    normalize: $('opt-normalize'), dialect: $('opt-dialect'),
    ws: $('opt-ws'), collapse: $('opt-collapse'),
    viewSplit: $('view-split'), viewUnified: $('view-unified'),
    banner: $('banner'), summary: $('summary'), diff: $('diff'),
    hunkBody: $('hunk-body'), hunkWrap: $('hunk-wrap'), toast: $('toast'),
  };

  const state = {
    view: 'split',
    oldName: '', newName: '',
    result: null, summary: null,
    expanded: new Set(), // fold keys the user opened
    current: 0, // last navigated hunk index (1-based)
  };

  // ---------- helpers ----------
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function debounce(fn, ms) {
    let t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  function showToast(msg) {
    els.toast.textContent = msg;
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => { els.toast.textContent = ''; }, 2000);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    showToast('Copied');
  }

  // ---------- compute ----------
  function compute() {
    let a = els.oldText.value;
    let b = els.newText.value;
    const notes = [];
    let warn = false;

    if (!a.trim() && !b.trim()) {
      state.result = null;
      els.summary.hidden = true;
      els.banner.hidden = true;
      els.diff.className = 'diff';
      els.diff.innerHTML = '<div class="placeholder">Paste or drop the original and new SQL to compare.</div>';
      return;
    }

    if (els.normalize.checked) {
      const lang = els.dialect.value;
      const fa = core.formatSql(a, lang);
      const fb = core.formatSql(b, lang);
      a = fa.text;
      b = fb.text;
      notes.push('Normalized with sql-formatter (' + els.dialect.selectedOptions[0].textContent + ') — line numbers refer to the formatted text, not your files.');
      if (fa.error) { warn = true; notes.push('Could not format Original, compared raw: ' + fa.error); }
      if (fb.error) { warn = true; notes.push('Could not format New, compared raw: ' + fb.error); }
    }
    if (els.ws.checked) notes.push('Whitespace-only differences are ignored.');

    els.banner.hidden = notes.length === 0;
    els.banner.className = 'banner' + (warn ? ' warn' : '');
    els.banner.innerHTML = notes.map(esc).join('<br>');

    state.result = core.computeDiff(a, b, { ignoreWhitespace: els.ws.checked });
    state.summary = core.summarize(state.result);
    state.current = 0;
    renderSummary();
    renderDiff();
  }

  // ---------- summary ----------
  function renderSummary() {
    const s = state.summary;
    els.summary.hidden = false;
    $('s-del').textContent = s.deleted;
    $('s-ins').textContent = s.inserted;
    $('s-eq').textContent = s.unchanged;
    $('s-hunks').textContent = s.hunkCount;
    $('s-total').textContent = s.oldTotal + ' → ' + s.newTotal;
    $('r-del').textContent = s.deletedRanges || '—';
    $('r-ins').textContent = s.insertedRanges || '—';
    els.hunkWrap.hidden = s.hunks.length === 0;
    els.hunkBody.innerHTML = s.hunks.map((h) =>
      '<tr data-hunk="' + h.index + '"><td>' + h.index + '</td><td>' + h.oldRange + '</td><td>' + h.newRange +
      '</td><td class="m">' + (h.deleted ? '−' + h.deleted : '') + '</td><td class="p">' + (h.inserted ? '+' + h.inserted : '') + '</td></tr>'
    ).join('');
  }

  // ---------- diff view ----------
  /**
   * Turn the flat line list into display rows.
   * split:   { kind: 'eq'|'chg', old: line|null, neu: line|null, hunk }
   * unified: { kind: 'eq'|'del'|'ins', line, hunk }
   */
  function buildRows(result, view) {
    const rows = [];
    const L = result.lines;
    let i = 0;
    while (i < L.length) {
      if (L[i].type === 'equal') {
        rows.push(view === 'split' ? { kind: 'eq', old: L[i], neu: L[i] } : { kind: 'eq', line: L[i] });
        i++;
        continue;
      }
      const hunk = L[i].hunk;
      const dels = [];
      const ins = [];
      while (i < L.length && L[i].hunk === hunk) {
        (L[i].type === 'deleted' ? dels : ins).push(L[i]);
        i++;
      }
      if (view === 'split') {
        for (let k = 0; k < Math.max(dels.length, ins.length); k++) {
          rows.push({ kind: 'chg', old: dels[k] || null, neu: ins[k] || null, hunk });
        }
      } else {
        dels.forEach((l) => rows.push({ kind: 'del', line: l, hunk }));
        ins.forEach((l) => rows.push({ kind: 'ins', line: l, hunk }));
      }
    }
    return rows;
  }

  /** Mark which equal rows are hidden by "collapse unchanged". */
  function visibility(rows) {
    const keep = rows.map((r) => r.kind !== 'eq');
    if (!els.collapse.checked) return keep.map(() => true);
    const vis = keep.slice();
    rows.forEach((r, idx) => {
      if (!keep[idx]) return;
      for (let d = 1; d <= CONTEXT; d++) {
        if (idx - d >= 0) vis[idx - d] = true;
        if (idx + d < rows.length) vis[idx + d] = true;
      }
    });
    return vis;
  }

  function wordPair(oldStr, newStr) {
    if (oldStr.length > WORD_DIFF_MAX || newStr.length > WORD_DIFF_MAX) return [esc(oldStr), esc(newStr)];
    let left = '';
    let right = '';
    for (const p of core.wordDiff(oldStr, newStr)) {
      const v = esc(p.value);
      if (p.added) right += '<ins>' + v + '</ins>';
      else if (p.removed) left += '<del>' + v + '</del>';
      else { left += v; right += v; }
    }
    return [left, right];
  }

  function renderDiff() {
    const res = state.result;
    const view = state.view;
    const rows = buildRows(res, view);
    const vis = visibility(rows);
    const oldL = (l) => res.oldLines[l.oldNo - 1];
    const newL = (l) => res.newLines[l.newNo - 1];
    const cols = view === 'split' ? 6 : 4;
    const seenHunk = new Set();
    const html = ['<table>'];

    let idx = 0;
    while (idx < rows.length) {
      // Folded run of hidden unchanged lines
      if (!vis[idx]) {
        let end = idx;
        while (end + 1 < rows.length && !vis[end + 1]) end++;
        const first = rows[idx].old || rows[idx].line;
        const key = 'f' + first.oldNo;
        if (!state.expanded.has(key)) {
          const n = end - idx + 1;
          html.push('<tr class="fold" data-fold="' + key + '"><td colspan="' + cols + '">⋯ ' + n +
            ' unchanged line' + (n === 1 ? '' : 's') + ' (click to expand)</td></tr>');
          idx = end + 1;
          continue;
        }
      }

      const r = rows[idx];
      let attrs = '';
      if (r.hunk && !seenHunk.has(r.hunk)) {
        seenHunk.add(r.hunk);
        attrs = ' id="hunk-' + r.hunk + '" class="hunk-start"';
      }

      if (view === 'split') {
        if (r.kind === 'eq') {
          html.push('<tr' + attrs + '><td class="no">' + r.old.oldNo + '</td><td class="sign"></td><td class="code">' + esc(oldL(r.old)) +
            '</td><td class="no">' + r.neu.newNo + '</td><td class="sign"></td><td class="code">' + esc(newL(r.neu)) + '</td></tr>');
        } else {
          let left = r.old ? esc(oldL(r.old)) : '';
          let right = r.neu ? esc(newL(r.neu)) : '';
          if (r.old && r.neu) [left, right] = wordPair(oldL(r.old), newL(r.neu));
          const l = r.old
            ? '<td class="no del">' + r.old.oldNo + '</td><td class="sign del">−</td><td class="code del">' + left + '</td>'
            : '<td class="no"></td><td class="sign empty"></td><td class="code empty"></td>';
          const rr = r.neu
            ? '<td class="no ins">' + r.neu.newNo + '</td><td class="sign ins">+</td><td class="code ins">' + right + '</td>'
            : '<td class="no"></td><td class="sign empty"></td><td class="code empty"></td>';
          html.push('<tr' + attrs + '>' + l + rr + '</tr>');
        }
      } else {
        const l = r.line;
        if (r.kind === 'eq') {
          html.push('<tr' + attrs + '><td class="no">' + l.oldNo + '</td><td class="no">' + l.newNo +
            '</td><td class="sign"></td><td class="code">' + esc(newL(l)) + '</td></tr>');
        } else if (r.kind === 'del') {
          html.push('<tr' + attrs + '><td class="no del">' + l.oldNo + '</td><td class="no"></td><td class="sign del">−</td><td class="code del">' +
            esc(oldL(l)) + '</td></tr>');
        } else {
          html.push('<tr' + attrs + '><td class="no"></td><td class="no ins">' + l.newNo + '</td><td class="sign ins">+</td><td class="code ins">' +
            esc(newL(l)) + '</td></tr>');
        }
      }
      idx++;
    }

    if (rows.length === 0) html.push('<tr><td class="placeholder">Both sides are empty.</td></tr>');
    else if (state.summary.hunkCount === 0) {
      html.splice(1, 0, '<tr class="fold"><td colspan="' + cols + '">No differences — the files are identical' +
        (els.normalize.checked || els.ws.checked ? ' under the current options' : '') + '.</td></tr>');
    }
    html.push('</table>');
    els.diff.className = 'diff ' + view;
    els.diff.innerHTML = html.join('');
  }

  function goToHunk(n) {
    const el = document.getElementById('hunk-' + n);
    if (!el) return;
    state.current = n;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash');
    void el.offsetWidth; // restart animation
    el.classList.add('flash');
  }

  // ---------- inputs ----------
  function setName(which, name) {
    state[which + 'Name'] = name;
    els[which + 'Name'].textContent = name;
    els[which + 'Name'].title = name;
  }

  async function loadFile(which, file) {
    if (!file) return;
    els[which + 'Text'].value = await file.text();
    setName(which, file.name);
    compute();
  }

  function wirePane(which) {
    const pane = $('pane-' + which);
    pane.addEventListener('dragover', (e) => { e.preventDefault(); pane.classList.add('drag'); });
    pane.addEventListener('dragleave', () => pane.classList.remove('drag'));
    pane.addEventListener('drop', (e) => {
      e.preventDefault();
      pane.classList.remove('drag');
      loadFile(which, e.dataTransfer.files[0]);
    });
    els[which + 'File'].addEventListener('change', (e) => { loadFile(which, e.target.files[0]); e.target.value = ''; });
    els[which + 'Text'].addEventListener('input', debounced);
  }

  const debounced = debounce(compute, 250);
  wirePane('old');
  wirePane('new');

  $('swap').addEventListener('click', () => {
    const t = els.oldText.value;
    els.oldText.value = els.newText.value;
    els.newText.value = t;
    const n = state.oldName;
    setName('old', state.newName);
    setName('new', n);
    compute();
  });

  [els.normalize, els.dialect, els.ws].forEach((el) => el.addEventListener('change', () => { state.expanded.clear(); compute(); }));
  els.collapse.addEventListener('change', () => { state.expanded.clear(); if (state.result) renderDiff(); });

  function setView(v) {
    state.view = v;
    els.viewSplit.classList.toggle('on', v === 'split');
    els.viewUnified.classList.toggle('on', v === 'unified');
    if (state.result) renderDiff();
  }
  els.viewSplit.addEventListener('click', () => setView('split'));
  els.viewUnified.addEventListener('click', () => setView('unified'));

  els.diff.addEventListener('click', (e) => {
    const fold = e.target.closest('tr.fold[data-fold]');
    if (!fold) return;
    state.expanded.add(fold.dataset.fold);
    renderDiff();
  });

  els.hunkBody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-hunk]');
    if (tr) goToHunk(Number(tr.dataset.hunk));
  });

  $('next-change').addEventListener('click', () => {
    const n = state.summary && state.summary.hunkCount;
    if (n) goToHunk(state.current >= n ? 1 : state.current + 1);
  });
  $('prev-change').addEventListener('click', () => {
    const n = state.summary && state.summary.hunkCount;
    if (n) goToHunk(state.current <= 1 ? n : state.current - 1);
  });

  // ---------- theme ----------
  const themeBtns = document.querySelectorAll('[data-theme-btn]');
  function setTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    themeBtns.forEach((b) => b.classList.toggle('on', b.dataset.themeBtn === t));
    try { localStorage.setItem('sqldiff-theme', t); } catch (e) {}
  }
  themeBtns.forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.themeBtn)));
  setTheme(document.documentElement.dataset.theme || 'auto');

  const names = () => ({ oldName: state.oldName || 'original.sql', newName: state.newName || 'new.sql' });

  $('copy-md').addEventListener('click', () => {
    if (!state.summary) return;
    copyText(core.toMarkdown(state.summary, Object.assign(names(), {
      normalized: els.normalize.checked,
      ignoreWhitespace: els.ws.checked,
    })));
  });
  $('copy-patch').addEventListener('click', () => {
    if (!state.result) return;
    const n = names();
    copyText(core.unifiedPatch(state.result, n.oldName, n.newName));
  });

  compute();
})();
