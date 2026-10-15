// Bundle index.html + CSS + JS into one self-contained file: dist/sqldiff.html
// Usage: node build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
// Keep inlined code from closing its own <script>/<style> tag early.
const safe = (code, tag) => code.replace(new RegExp('</' + tag, 'gi'), '<\\/' + tag);

let html = read('index.html');

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) =>
  '<style>\n' + safe(read(href), 'style') + '\n</style>');

html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) =>
  '<script>\n' + safe(read(src), 'script') + '\n</script>');

if (/<script src=|<link rel="stylesheet"/.test(html)) throw new Error('unresolved external reference left in output');

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'sqldiff.html'), html);
console.log('wrote dist/sqldiff.html (' + Math.round(html.length / 1024) + ' KB)');
