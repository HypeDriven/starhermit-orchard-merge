// Unit tests for the pure graphics quality model (src/gfx.js) and the panel's locale picker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, CATEGORIES, detectPreset, resolve, presetTier, describe, choosePreset } from '../src/gfx.js';
import { GFX_STRINGS, pickLocale, translator } from '../src/gfx-i18n.js';

test('detectPreset maps GPU strings to tiers', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)'), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'high');
  assert.equal(detectPreset('Apple M2'), 'high');
  assert.equal(detectPreset('ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0)'), 'high');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)'), 'balanced');
  assert.equal(detectPreset('Adreno (TM) 650'), 'balanced');
  assert.equal(detectPreset(''), 'balanced');
  assert.equal(detectPreset(undefined), 'balanced');
});

test('touch-first devices cap Auto at balanced', () => {
  assert.equal(detectPreset('Apple M1', { mobile: true }), 'balanced');
  assert.equal(detectPreset('SwiftShader', { mobile: true }), 'low');
});

test('resolve: auto follows the detected preset', () => {
  const r = resolve({ preset: 'auto' }, 'low');
  assert.equal(r.preset, 'low');
  assert.equal(r.auto, true);
  assert.equal(r.shadows, 'off');
  assert.equal(r.post, false, 'Low renders without a composer');
  assert.equal(resolve({}, 'high').preset, 'high');
  assert.equal(resolve(null, undefined).preset, 'balanced');
});

test('resolve: explicit preset rows and overrides', () => {
  const hi = resolve({ preset: 'high' }, 'low');
  assert.equal(hi.auto, false);
  assert.equal(hi.shadows, 'medium');
  assert.equal(hi.ao, 'on');
  assert.equal(hi.antialias, 'smaa');
  assert.equal(hi.post, true);
  const o = resolve({ preset: 'high', bloom: 'off', shadows: 'high', detail: 'bogus' }, 'low');
  assert.equal(o.bloom, 'off');
  assert.equal(o.shadows, 'high');
  assert.equal(o.detail, 'detailed', 'unknown tier falls back to the preset');
  for (const p of PRESETS) {
    const r = resolve({ preset: p }, 'low');
    for (const [cat, tiers] of Object.entries(CATEGORIES)) {
      assert.ok(tiers.includes(r[cat]), `${p}.${cat}`);
      assert.equal(presetTier(p, cat), r[cat]);
    }
  }
});

test('resolve: render scale multiplies the preset scale and is clamped to 50–200%', () => {
  assert.equal(resolve({ preset: 'balanced', render_scale: 1.5 }).scale, 1.5);
  assert.equal(resolve({ preset: 'balanced', render_scale: 9 }).scale, 2);
  assert.equal(resolve({ preset: 'balanced', render_scale: 0.1 }).scale, 0.5);
  assert.equal(resolve({ preset: 'ultra', render_scale: 2 }).scale, 2.5);
  assert.equal(resolve({ preset: 'low' }).scale, 0.75);
  assert.equal(resolve({ preset: 'low' }).dprCap, 1);
  assert.equal(resolve({ preset: 'high' }).dprCap, 2);
});

test('resolve: adaptive defaults on, frame-rate readout defaults off', () => {
  const r = resolve({}, 'low');
  assert.equal(r.adaptive, true);
  assert.equal(r.showFps, false);
  const r2 = resolve({ adaptive: false, show_fps: true }, 'low');
  assert.equal(r2.adaptive, false);
  assert.equal(r2.showFps, true);
});

test('choosing a preset clears overrides but keeps scale / adaptive / fps', () => {
  const saved = { preset: 'high', bloom: 'off', shadows: 'low', render_scale: 1.25, adaptive: false, show_fps: true };
  const next = choosePreset(saved, 'low');
  assert.deepEqual(next, { preset: 'low', render_scale: 1.25, adaptive: false, show_fps: true });
  assert.equal(resolve(next, 'high').bloom, 'off', 'Low has no bloom of its own');
  assert.equal(resolve(choosePreset(saved, 'high'), 'low').bloom, 'on');
  assert.equal(choosePreset(saved, 'nonsense').preset, 'auto');
});

test('describe summarises cost', () => {
  const s = describe(resolve({ preset: 'high' }), [1280, 800]);
  assert.match(s, /2048² shadows/);
  assert.match(s, /bloom/);
  assert.match(s, /SMAA/);
  assert.match(s, /1280×800 px$/);
  assert.match(describe(resolve({ preset: 'low' })), /no shadows.*no anti-aliasing/);
});

test('graphics strings exist for every required locale', () => {
  const need = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
  const keys = Object.keys(GFX_STRINGS['en-US']);
  for (const loc of need) {
    assert.ok(GFX_STRINGS[loc], loc);
    for (const k of keys) assert.ok(GFX_STRINGS[loc][k], `${loc}.${k}`);
    for (const cat of Object.keys(CATEGORIES)) {
      assert.ok(GFX_STRINGS[loc]['cat_' + cat], `${loc} cat_${cat}`);
      for (const t of CATEGORIES[cat]) assert.ok(GFX_STRINGS[loc]['t_' + t], `${loc} t_${t}`);
    }
  }
  assert.equal(pickLocale('en-AU'), 'en-GB');
  assert.equal(pickLocale('es-MX'), 'es-419');
  assert.equal(pickLocale('es'), 'es-ES');
  assert.equal(pickLocale('fr-CA'), 'fr-CA');
  assert.equal(pickLocale('pt-PT'), 'pt-BR');
  assert.equal(pickLocale('ja-JP'), 'en-US');
  assert.equal(translator('de-DE')('auto', { tier: 'Niedrig' }), 'Automatisch (erkannt: Niedrig)');
});
