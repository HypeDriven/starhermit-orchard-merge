// Every player-facing string exists in all nine locales (node --test).
// Keys are the US-English source strings (see tests/i18n-keys.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DICTS, LOCALES, T, setLocale } from '../src/i18n.js';
import { GFX_STRINGS, translator } from '../src/gfx-i18n.js';
import { ALL } from './i18n-keys.mjs';

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
    assert.deepEqual([...ALL].filter((k) => placeholders(dict[k]) !== placeholders(k)), [], 'placeholder mismatch');
    assert.deepEqual([...ALL].filter((k) => tags(dict[k]) !== tags(k)), [], 'markup mismatch');
  });
}

test('no locale carries keys that no longer exist', () => {
  for (const locale of LOCALES) {
    const stray = Object.keys(DICTS[locale]).filter((k) => !ALL.has(k));
    assert.deepEqual(stray, [], locale);
  }
});

test('Graphics and StarHermit strings exist in all nine locales', () => {
  for (const locale of LOCALES) {
    assert.ok(GFX_STRINGS[locale], locale);
    assert.notEqual(translator(locale)('sh_signIn'), 'sh_signIn', locale);
  }
  assert.notEqual(translator('de-DE')('graphics'), translator('en-US')('graphics'));
});

test('T falls back to the key and fills placeholders; regional variants inherit', () => {
  setLocale('de-DE');
  assert.equal(T('Not a real key {x}', { x: 1 }), 'Not a real key 1');
  assert.equal(T('Now: {fruit}', { fruit: 'Kirsche (1)' }), 'Jetzt: Kirsche (1)');
  setLocale('fr-CA');
  assert.equal(T('Score'), 'Pointage');
  assert.equal(T('Hint'), 'Indice');
  setLocale('es-ES');
  assert.equal(T('Settings'), 'Ajustes');
  assert.equal(T('Hint'), 'Pista');
  setLocale('en-GB');
  assert.equal(T('Color palette'), 'Colour palette');
  setLocale('en-US');
  assert.equal(T('Hint'), 'Hint');
});
