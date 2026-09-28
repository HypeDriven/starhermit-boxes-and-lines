/* Boxes & Lines — unit tests for the graphics quality model (js/gfx.js).
 * Run: node --test tests/gfx.test.mjs
 * gfx.js is a browser ES module in a CommonJS package, so it is loaded from source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/gfx.js', import.meta.url), 'utf8');
const gfx = await import('data:text/javascript,' + encodeURIComponent(src));
const { detectPreset, resolve, presetTier, choosePreset, describe, CATEGORIES, PRESETS } = gfx;

test('detectPreset maps GPU strings to presets', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)'), 'high');
  assert.equal(detectPreset('Apple M2 Pro'), 'high');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)'), 'balanced');
  assert.equal(detectPreset('Mali-G78'), 'balanced');
  assert.equal(detectPreset(''), 'balanced');
});

test('detectPreset caps touch/mobile devices at balanced', () => {
  assert.equal(detectPreset('Apple M1', true), 'balanced');
  assert.equal(detectPreset('Adreno (TM) 740', true), 'balanced');
  assert.equal(detectPreset('SwiftShader', true), 'low');
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
