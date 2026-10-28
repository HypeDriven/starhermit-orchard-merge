// Key extraction for the i18n coverage test (run directly to list the keys).
// Keys are the US-English source strings: literal T('…') / N('…') calls in
// src/*.js (the shared pure modules) and native/*.ts (the engine client).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP = new Set(['i18n.js', 'sh-strings.js', 'i18n.ts']);
const unescape = (s) => s.replace(/\\(['"`\\])/g, '$1');

export function sourceKeys() {
  const keys = new Set();
  const call = /(?<![\w.$])(?:T|N)\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")/g;
  for (const dir of ['src', 'native']) {
    for (const f of readdirSync(join(ROOT, dir))) {
      if (!/\.(js|ts)$/.test(f) || SKIP.has(f)) continue;
      const src = readFileSync(join(ROOT, dir, f), 'utf8');
      for (const m of src.matchAll(call)) keys.add(unescape(m[1] ?? m[2]));
    }
  }
  return keys;
}

export const ALL = sourceKeys();

if (process.argv[1] && process.argv[1].endsWith('i18n-keys.mjs')) console.log(JSON.stringify([...ALL], null, 1));
