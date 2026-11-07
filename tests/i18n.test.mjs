// Every player-facing string exists in all nine locales (node --test).
// Keys are the US-English source strings in src/ and native/ (see tests/i18n-keys.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALL } from './i18n-keys.mjs';

const DICTS = JSON.parse(readFileSync(new URL('../assets/strings.json', import.meta.url), 'utf8'));
const LOCALES = Object.keys(DICTS);
const PARENT = { 'en-GB': 'en-US' };

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const tags = (s) => (String(s).match(/<[^>]+>/g) || []).join('');

test('the key set is non-trivial', () => {
  assert.ok(ALL.size > 120, `only ${ALL.size} keys found`);
});

for (const locale of LOCALES.filter((l) => l !== 'en-US' && l !== 'en-GB')) {
  test(`${locale}: every key used in markup and code is translated with the same placeholders and markup`, () => {
    const dict = DICTS[locale];
    const missing = [...ALL].filter((k) => !Object.prototype.hasOwnProperty.call(dict, k));
    assert.deepEqual(missing, [], `${missing.length} missing in ${locale}`);
    const en = DICTS['en-US'];
    assert.deepEqual([...ALL].filter((k) => placeholders(dict[k]) !== placeholders(en[k])), [], 'placeholder mismatch');
    assert.deepEqual([...ALL].filter((k) => tags(dict[k]) !== tags(en[k])), [], 'markup mismatch');
  });
}

test('no locale carries keys that no longer exist', () => {
  for (const locale of LOCALES) {
    const stray = Object.keys(DICTS[locale]).filter((k) => !ALL.has(k));
    assert.deepEqual(stray, [], locale);
  }
});

test('regional variants read their own or the shared text', () => {
  const T = (l, k) => { for (let c = l; c; c = PARENT[c]) if (Object.hasOwn(DICTS[c], k)) return DICTS[c][k]; return k; };
  assert.equal(T('fr-CA', 'Score'), 'Pointage');
  assert.equal(T('fr-CA', 'Hint'), 'Indice');
  assert.equal(T('es-ES', 'Settings'), 'Ajustes');
  assert.equal(T('es-ES', 'Hint'), 'Pista');
  assert.equal(T('en-GB', 'Color palette'), 'Colour palette');
  assert.equal(T('en-US', 'Hint'), 'Hint');
});
