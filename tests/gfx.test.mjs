/* Boxes & Lines — unit tests for the graphics quality model (js/gfx.js).
 * Run: node --test tests/gfx.test.mjs
 * gfx.js is a browser ES module in a CommonJS package, so it is loaded from source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

globalThis.StarHermitGpu = createRequire(import.meta.url)('../js/gpu-level.js');
const src = readFileSync(new URL('../js/gfx.js', import.meta.url), 'utf8');
const gfx = await import('data:text/javascript,' + encodeURIComponent(src));
const { detectPreset, detectLevel, presetForLevel, BUDGETS, resolve, presetTier, choosePreset, describe, CATEGORIES, PRESETS } = gfx;

test('hardware level maps GPUs to presets (Low 0, Balanced 4, High 10, Ultra 17)', () => {
  const desk = { webgl: true, webgl2: true, cores: 8, memoryGb: 8 };
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', desk), 'low');
  assert.equal(detectLevel('llvmpipe (LLVM 15.0.7, 256 bits)', desk), 0);
  assert.equal(detectPreset('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0)', desk), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)', desk), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', desk), 'balanced');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)', desk), 'high');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)', desk), 'ultra');
  assert.equal(detectLevel('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', desk), 20);
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', desk), 'ultra');
  assert.equal(detectPreset('', desk), 'balanced', 'an unlisted desktop GPU starts at Balanced');
  assert.equal(presetForLevel(3), 'low');
  assert.equal(presetForLevel(9), 'balanced');
  assert.equal(presetForLevel(16), 'high');
});

test('phones and tablets are capped at Balanced; software GPUs stay Low', () => {
  const phone = { webgl: true, webgl2: true, mobile: true, cores: 8, memoryGb: 8 };
  assert.equal(detectPreset('Adreno (TM) 740', phone), 'balanced');
  assert.ok(detectLevel('Adreno (TM) 740', phone) <= 9);
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090)', phone), 'balanced');
  assert.equal(detectPreset('Mali-G77', phone), 'low');
  assert.equal(detectPreset('SwiftShader', phone), 'low');
});

test('resolve: auto uses the detected preset, explicit preset wins', () => {
  const a = resolve({}, 'high');
  assert.equal(a.preset, 'high');
  assert.equal(a.auto, true);
  const b = resolve({ preset: 'low' }, 'high');
  assert.equal(b.preset, 'low');
  assert.equal(b.auto, false);
  assert.equal(b.shadows, 'off');
  assert.equal(b.post, false, 'low preset renders without post-processing');
  assert.equal(resolve({ preset: 'bogus' }, 'nope').preset, 'balanced');
});

test('resolve: overrides replace preset tiers, invalid ones are ignored', () => {
  const r = resolve({ preset: 'high', bloom: 'off', shadows: 'high', ao: 'extreme' }, 'low');
  assert.equal(r.bloom, 'off');
  assert.equal(r.shadows, 'high');
  assert.equal(r.ao, presetTier('high', 'ao'));
  const low = resolve({ preset: 'low', ao: 'on' }, 'low');
  assert.equal(low.post, true, 'an AO override turns the post chain on');
});

test('resolve: render scale is clamped to 50–200% and multiplies the preset scale', () => {
  assert.equal(resolve({ preset: 'high', render_scale: 5 }).scale, 2);
  assert.equal(resolve({ preset: 'high', render_scale: 0.1 }).scale, 0.5);
  assert.equal(resolve({ preset: 'ultra', render_scale: 1 }).scale, 1.25);
  assert.equal(resolve({ preset: 'high', render_scale: 'x' }).scale, 1);
  assert.equal(resolve({}).adaptive, true);
  assert.equal(resolve({ adaptive: false }).adaptive, false);
  assert.equal(resolve({}).showFps, false);
});

test('choosing a preset clears overrides but keeps scale/adaptive/fps', () => {
  const s = choosePreset({ preset: 'high', bloom: 'off', detail: 'plain', render_scale: 1.5, adaptive: false, show_fps: true }, 'ultra');
  assert.deepEqual(s, { preset: 'ultra', render_scale: 1.5, adaptive: false, show_fps: true });
  assert.deepEqual(choosePreset({ bloom: 'off' }, 'auto'), { preset: 'auto' });
});

test('every preset defines every category with a valid tier', () => {
  for (const p of PRESETS) {
    for (const [cat, tiers] of Object.entries(CATEGORIES)) {
      assert.ok(tiers.includes(presetTier(p, cat)), `${p}.${cat}`);
    }
  }
});

test('describe summarises cost and resolution', () => {
  const d = describe(resolve({ preset: 'ultra' }), [1920, 1080]);
  assert.match(d, /4096² shadows/);
  assert.match(d, /1920×1080 px/);
  assert.match(describe(resolve({ preset: 'low' })), /no shadows/);
});

test('graphics strings exist for every supported locale and fall back sensibly', async () => {
  const s = readFileSync(new URL('../js/gfx-strings.js', import.meta.url), 'utf8');
  const { GFX_STRINGS, gfxStrings } = await import('data:text/javascript,' + encodeURIComponent(s));
  const locales = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
  const en = GFX_STRINGS['en-US'];
  for (const loc of locales) {
    const t = GFX_STRINGS[loc];
    assert.ok(t, loc);
    for (const k of Object.keys(en)) assert.ok(t[k], `${loc}.${k}`);
    for (const cat of Object.keys(CATEGORIES)) {
      assert.ok(t.cat[cat], `${loc}.cat.${cat}`);
      for (const tier of CATEGORIES[cat]) assert.ok(t.tier[tier], `${loc}.tier.${tier}`);
    }
    for (const p of PRESETS) assert.ok(t.tier[p], `${loc}.tier.${p}`);
    assert.match(t.auto, /\{tier\}/);
    assert.match(t.fromPreset, /\{tier\}/);
  }
  assert.equal(gfxStrings(['de-AT']), GFX_STRINGS['de-DE']);
  assert.equal(gfxStrings(['es-MX']), GFX_STRINGS['es-419']);
  assert.equal(gfxStrings(['es-ES']), GFX_STRINGS['es-ES']);
  assert.equal(gfxStrings(['ja-JP']), en);
});

test('every preset has an explicit budget that grows from Low to Ultra', () => {
  const order = ['low', 'balanced', 'high', 'ultra'];
  for (const p of order) {
    const b = BUDGETS[p];
    assert.ok(b, p);
    for (const k of ['dprCap', 'texture', 'paperCell', 'dotSegments', 'material', 'bloomRes', 'aoRes', 'particles', 'dust']) assert.ok(b[k] != null, `${p}.${k}`);
  }
  for (let i = 1; i < order.length; i++) {
    const a = BUDGETS[order[i - 1]], b = BUDGETS[order[i]];
    for (const k of ['dprCap', 'texture', 'paperCell', 'dotSegments', 'particles', 'dust']) assert.ok(b[k] >= a[k], `${order[i]}.${k} >= ${order[i - 1]}`);
  }
  assert.equal(BUDGETS.low.material, 'lambert');
  assert.equal(BUDGETS.ultra.material, 'physical');
  assert.equal(BUDGETS.low.dprCap, 1);
});

test('resolve attaches the budget; counts scale with the level but never below the preset floor', () => {
  const low0 = resolve({ preset: 'low' }, 'low', 0).budget;
  assert.equal(low0.particles, BUDGETS.low.particles);
  const ultra20 = resolve({ preset: 'ultra' }, 'ultra', 20).budget;
  assert.ok(ultra20.particles > BUDGETS.ultra.particles && ultra20.particles <= 260);
  const ultraWeak = resolve({ preset: 'ultra' }, 'low', 0).budget;
  assert.equal(ultraWeak.particles, BUDGETS.ultra.particles, 'a manual Ultra on a weak GPU keeps the Ultra floor budget');
  assert.equal(resolve({}, 'high', 12).budget.texture, BUDGETS.high.texture);
});
