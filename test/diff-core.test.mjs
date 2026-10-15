import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../diff-core.js');

const run = (a, b, opts) => core.summarize(core.computeDiff(a, b, opts));

test('identical files have no changes', () => {
  const s = run('SELECT 1\nFROM t\n', 'SELECT 1\nFROM t\n');
  assert.equal(s.deleted, 0);
  assert.equal(s.inserted, 0);
  assert.equal(s.unchanged, 2);
  assert.equal(s.hunkCount, 0);
});

test('pure insertion reports new line numbers', () => {
  const s = run('a\nb\nc\n', 'a\nb\nx\ny\nc\n');
  assert.equal(s.inserted, 2);
  assert.equal(s.deleted, 0);
  assert.deepEqual(s.insertedLines, [3, 4]);
  assert.equal(s.insertedRanges, '3–4');
  assert.equal(s.hunks[0].oldRange, 'after 2');
  assert.equal(s.hunks[0].newRange, '3–4');
});

test('pure deletion reports original line numbers', () => {
  const s = run('a\nb\nc\nd\n', 'a\nd\n');
  assert.equal(s.deleted, 2);
  assert.equal(s.inserted, 0);
  assert.deepEqual(s.deletedLines, [2, 3]);
  assert.equal(s.hunks[0].newRange, 'after 1');
});

test('modified line counts as 1 deleted + 1 inserted', () => {
  const s = run('SELECT a\nFROM t\nWHERE x = 1\n', 'SELECT a\nFROM t\nWHERE x = 2\n');
  assert.equal(s.deleted, 1);
  assert.equal(s.inserted, 1);
  assert.deepEqual(s.deletedLines, [3]);
  assert.deepEqual(s.insertedLines, [3]);
  assert.equal(s.hunkCount, 1);
});

test('multiple hunks and range compression', () => {
  const old = Array.from({ length: 20 }, (_, i) => 'l' + (i + 1)).join('\n');
  const neu = old.split('\n').filter((_, i) => i !== 1 && !(i >= 13 && i <= 17)).join('\n');
  const s = run(old, neu);
  assert.equal(s.deleted, 6);
  assert.equal(s.deletedRanges, '2, 14–18');
  assert.equal(s.hunkCount, 2);
});

test('compressRanges', () => {
  assert.equal(core.compressRanges([12, 14, 15, 16, 17, 18, 40]), '12, 14–18, 40');
  assert.equal(core.compressRanges([]), '');
});

test('CRLF vs LF and missing trailing newline are equal', () => {
  const s = run('SELECT 1\r\nFROM t\r\n', 'SELECT 1\nFROM t');
  assert.equal(s.deleted, 0);
  assert.equal(s.inserted, 0);
});

test('empty side counts everything', () => {
  assert.equal(run('', 'a\nb\n').inserted, 2);
  assert.equal(run('a\nb\n', '').deleted, 2);
});

test('ignoreWhitespace hides indentation changes', () => {
  const s = run('SELECT a\nFROM t\n', '  SELECT a\nFROM   t\n', { ignoreWhitespace: true });
  assert.equal(s.deleted + s.inserted, 0);
});

test('formatSql keeps Airflow Jinja and does not throw', () => {
  const sql = "select a, b from {{ params.dataset }}.events where ds = '{{ ds }}' {% if params.full %}and x > 1{% endif %}";
  const { text, error } = core.formatSql(sql, 'bigquery');
  assert.equal(error, null);
  assert.match(text, /\{\{ params\.dataset \}\}/);
  assert.match(text, /\{\{ ds \}\}/);
  assert.match(text, /\{% if params\.full %\}/);
  assert.match(text, /SELECT/);
});

test('reformat-only change is empty after normalization', () => {
  const a = core.formatSql('select a,b from t where x=1', 'sql').text;
  const b = core.formatSql('SELECT a,\n   b\nFROM t\nWHERE x = 1', 'sql').text;
  const s = run(a, b);
  assert.equal(s.deleted + s.inserted, 0);
});

test('markdown summary contains counts and ranges', () => {
  const s = run('a\nb\n', 'a\nc\n');
  const md = core.toMarkdown(s, { oldName: 'old.sql', newName: 'new.sql' });
  assert.match(md, /Deleted \(from original\) \| \*\*1\*\*/);
  assert.match(md, /Inserted line numbers \(new\): 2/);
});
