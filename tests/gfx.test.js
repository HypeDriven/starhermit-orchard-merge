// Unit tests for the pure graphics quality model (src/gfx.js) and the panel's locale picker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// src/gpu-level.js is a classic script in the page (window.StarHermitGpu); evaluate it the same way here.
new Function('window', 'module', readFileSync(new URL('../src/gpu-level.js', import.meta.url), 'utf8'))(globalThis, undefined);
const { PRESETS, CATEGORIES, detectPreset, detectLevel, presetForLevel, budgetFor, sparkCap, resolve, presetTier, describe, choosePreset, LEVELS, BUDGETS, SPARK_MAX, MOTE_MAX } = await import('../src/gfx.js');
const { GFX_STRINGS, pickLocale, translator } = await import('../src/gfx-i18n.js');

const DESK = { cores: 8, memoryGb: 8 };
const PHONE = { mobile: true, cores: 8, memoryGb: 8 };

test('hardware level picks the Auto preset (Low 0, Balanced 4, High 10, Ultra 17)', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', DESK), 'low');
  assert.equal(detectLevel('llvmpipe (LLVM 15.0.7, 256 bits)', DESK), 0);
  assert.equal(detectPreset('', DESK), 'low', 'no WebGL');
  assert.equal(detectPreset('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', DESK), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)', DESK), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', DESK), 'balanced');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)', DESK), 'high');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  assert.equal(detectLevel('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 20);
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  for (const [p, lv] of Object.entries(LEVELS)) assert.equal(presetForLevel(lv), p);
  assert.equal(presetForLevel(3), 'low');
  assert.equal(presetForLevel(16), 'high');
});

test('phones and tablets are Balanced at most; software GPUs stay Low', () => {
  assert.equal(detectPreset('Adreno (TM) 740', PHONE), 'balanced');
  assert.ok(detectLevel('Adreno (TM) 740', PHONE) <= 9);
  assert.equal(detectPreset('Apple M1', PHONE), 'balanced');
  assert.equal(detectPreset('SwiftShader', PHONE), 'low');
});

test('per-preset budgets are explicit, grow from Low to Ultra and scale with the level', () => {
  const keys = ['material', 'sphere', 'skinBump', 'texture', 'trees', 'fruitPerTree', 'sparks', 'motes', 'bloomRes', 'aoRes'];
  for (const p of PRESETS) for (const k of keys) assert.ok(BUDGETS[p][k] != null, `${p}.${k}`);
  for (let i = 1; i < PRESETS.length; i++) for (const k of keys) {
    if (typeof BUDGETS.low[k] === 'number') assert.ok(BUDGETS[PRESETS[i]][k] >= BUDGETS[PRESETS[i - 1]][k], `${PRESETS[i]}.${k}`);
    if (k === 'sphere') assert.ok(BUDGETS[PRESETS[i]].sphere[0] >= BUDGETS[PRESETS[i - 1]].sphere[0]);
  }
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].material), ['lambert', 'standard', 'physical', 'physical']);
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].bloomRes), [0.5, 0.5, 0.5, 1], 'half-res bloom below Ultra');
  assert.deepEqual(resolve({ preset: 'high' }, 'low', 10).budget, BUDGETS.high, 'floor level = the tuned budget');
  assert.deepEqual(resolve({ preset: 'ultra' }, 'low', 0).budget, resolve({ preset: 'ultra' }, 'ultra', 17).budget);
  assert.ok(budgetFor('balanced', 9).motes > budgetFor('balanced', 4).motes, 'counts scale up within the preset');
  assert.ok(budgetFor('ultra', 20).sparks <= SPARK_MAX && budgetFor('ultra', 20).motes <= MOTE_MAX);
  assert.equal(sparkCap(resolve({ preset: 'high' }, 'low', 10)), BUDGETS.high.sparks);
  assert.equal(sparkCap(resolve({ preset: 'low' }, 'low', 0)), 0, 'Low: particles off');
  assert.equal(resolve({}, 'low', 0).budget.material, 'lambert', 'headless SwiftShader: Low, Lambert');
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

test('graphics summary level label in every locale', () => {
  for (const loc of Object.keys(GFX_STRINGS)) assert.match(translator(loc)('level', { n: 7 }), /7$/, loc);
  assert.equal(translator('de-DE')('level', { n: 3 }), 'Stufe 3');
});
