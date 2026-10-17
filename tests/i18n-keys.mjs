// Key extraction for the i18n coverage test (run directly to list the keys).
// Keys are the US-English source strings: literal T('…') / N('…') calls in src/,
// and data-i18n / data-i18n-aria / data-i18n-title / data-i18n-html markup in
// index.html (rich-text paragraphs use their authored innerHTML).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP = new Set(['i18n.js', 'gfx-i18n.js']);
const unescape = (s) => s.replace(/\\(['"`\\])/g, '$1');

export function sourceKeys() {
  const keys = new Set();
  const call = /(?<![\w.$])(?:T|N)\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")/g;
  for (const f of readdirSync(join(ROOT, 'src'))) {
    if (!f.endsWith('.js') || SKIP.has(f)) continue;
    const src = readFileSync(join(ROOT, 'src', f), 'utf8');
    for (const m of src.matchAll(call)) keys.add(unescape(m[1] ?? m[2]));
  }
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-aria|-title)?="([^"]+)"/g)) keys.add(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  for (const m of html.matchAll(/<p data-i18n-html>([\s\S]*?)<\/p>/g)) keys.add(m[1].trim());
  return keys;
}

export const ALL = sourceKeys();

if (process.argv[1] && process.argv[1].endsWith('i18n-keys.mjs')) console.log(JSON.stringify([...ALL], null, 1));
