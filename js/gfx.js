/* Boxes & Lines — graphics quality model: presets, per-category overrides,
 * GPU detection and a cost summary. Pure (no three.js, no DOM), so the
 * settings panel, the renderer and the unit tests agree on what a setting means.
 */

export var PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category → allowed tiers, cheapest first.
export var CATEGORIES = {
  shadows: ['off', 'low', 'medium', 'high'],
  ao: ['off', 'on', 'high'],
  bloom: ['off', 'on'],
  grade: ['off', 'on'],
  antialias: ['off', 'fxaa', 'smaa', 'msaa'],
  reflections: ['off', 'on'],   // desk-room environment lighting (IBL)
  detail: ['plain', 'detailed'], // wood grain / paper fibre relief, lacquered pieces
  particles: ['low', 'high'],    // paper bursts and confetti budget
  ambient: ['static', 'animated'] // drifting dust motes, lamp shimmer, turn-token pulse
};

// Each preset is a row of tiers plus a render scale (multiplies the device pixel ratio).
var TABLE = {
  low:      { scale: 0.8,  shadows: 'off',    ao: 'off',  bloom: 'off', grade: 'off', antialias: 'msaa', reflections: 'off', detail: 'plain',    particles: 'low',  ambient: 'static' },
  balanced: { scale: 0.9,  shadows: 'low',    ao: 'off',  bloom: 'on',  grade: 'on',  antialias: 'fxaa', reflections: 'on',  detail: 'detailed', particles: 'high', ambient: 'animated' },
  high:     { scale: 1,    shadows: 'medium', ao: 'on',   bloom: 'on',  grade: 'on',  antialias: 'smaa', reflections: 'on',  detail: 'detailed', particles: 'high', ambient: 'animated' },
  ultra:    { scale: 1.25, shadows: 'high',   ao: 'high', bloom: 'on',  grade: 'on',  antialias: 'msaa', reflections: 'on',  detail: 'detailed', particles: 'high', ambient: 'animated' }
};

export var SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };
export var PARTICLE_BUDGET = { low: 80, high: 300 };

// Per-preset asset and effect budget. Each preset is tuned to hold 60 FPS on the weakest GPU Auto gives
// it (Low → hardware level 0, Balanced → 4, High → 10, Ultra → 17; see tests/gfx-bench.mjs):
//   dprCap      device-pixel-ratio ceiling before the preset's render scale;
//   texture     desk texture edge in px (the desk relief is half of it, paper fibre a quarter);
//   paperCell   sheet grid texture px per board cell;
//   dotSegments ink-pin cylinder segments; material: 'lambert' | 'standard' | 'physical' (clearcoat);
//   bloomRes / aoRes  post-effect resolution as a fraction of the frame;
//   particles / dust  confetti chips and ambient motes at the preset's floor level — scaled up within the
//               preset by StarHermitGpu.scaleBudget on faster GPUs (never below the floor budget).
export var BUDGETS = {
  low:      { dprCap: 1,   texture: 256,  paperCell: 32, dotSegments: 8,  material: 'lambert',  bloomRes: 0.5, aoRes: 0.5, particles: 40,  dust: 12 },
  balanced: { dprCap: 1.5, texture: 512,  paperCell: 48, dotSegments: 12, material: 'standard', bloomRes: 0.5, aoRes: 0.5, particles: 90,  dust: 24 },
  high:     { dprCap: 2,   texture: 1024, paperCell: 64, dotSegments: 16, material: 'physical', bloomRes: 0.5, aoRes: 0.5, particles: 160, dust: 36 },
  ultra:    { dprCap: 2,   texture: 2048, paperCell: 96, dotSegments: 24, material: 'physical', bloomRes: 1,   aoRes: 1,   particles: 220, dust: 48 }
};
export var MAX_PARTICLES = 260; // confetti pool size (BUDGETS × scaleBudget is capped here)
export var MAX_DUST = 48;

/** A preset's budget for a hardware level: counts scale with the GPU above the preset's floor (≤ 4×). */
export function budgetFor(preset, level) {
  var b = Object.assign({}, BUDGETS[preset] || BUDGETS.balanced);
  var floor = PRESET_LEVELS[preset] || 0;
  var lv = Math.max(Number(level) || 0, floor);
  var G = gpuApi();
  var scale = function (n) { return G ? G.scaleBudget(n, lv, floor) : n; };
  b.particles = Math.min(MAX_PARTICLES, Math.round(scale(b.particles)));
  b.dust = Math.min(MAX_DUST, Math.round(scale(b.dust)));
  return b;
}

// Auto picks the preset from the StarHermit hardware level (0 = Galaxy S20 / Intel UHD, 20 = RTX 5090;
// js/gpu-level.js → window.StarHermitGpu): Low from 0, Balanced from 4, High from 10, Ultra from 17.
export var PRESET_LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };

function gpuApi() { return typeof StarHermitGpu !== 'undefined' ? StarHermitGpu : globalThis.StarHermitGpu; }

/** Hardware level (0–20) for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
export function detectLevel(gpu, system) {
  var G = gpuApi();
  if (!G) return PRESET_LEVELS.balanced;
  return G.detectLevel(Object.assign({}, system || {}, { gpu: String(gpu || '') }));
}

/** The preset Auto starts from for a hardware level. */
export function presetForLevel(level) {
  var G = gpuApi();
  if (G) return G.presetForLevel(level, PRESET_LEVELS);
  return level >= 17 ? 'ultra' : level >= 10 ? 'high' : level >= 4 ? 'balanced' : 'low';
}

/** Best preset for this GPU (phones/tablets and ≤ 4 GB machines are capped at Balanced by the level). */
export function detectPreset(gpu, system) {
  return presetForLevel(detectLevel(gpu, system));
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

/**
 * Resolve saved settings into concrete tiers.
 * saved: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected, level) {
  var s = saved || {};
  var auto = PRESETS.indexOf(s.preset) < 0;
  var preset = auto ? (PRESETS.indexOf(detected) >= 0 ? detected : 'balanced') : s.preset;
  var row = TABLE[preset];
  var out = {
    preset: preset,
    auto: auto,
    renderScale: clampScale(s.render_scale),
    scale: 0
  };
  out.scale = row.scale * out.renderScale;
  Object.keys(CATEGORIES).forEach(function (cat) {
    out[cat] = CATEGORIES[cat].indexOf(s[cat]) >= 0 ? s[cat] : row[cat];
  });
  out.budget = budgetFor(preset, level);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // Post-processing runs only when something needs it; otherwise the canvas's own MSAA is used.
  out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on' ||
    out.antialias === 'fxaa' || out.antialias === 'smaa';
  return out;
}

export function clampScale(v) {
  var n = Number(v);
  return clamp(isFinite(n) && n > 0 ? n : 1, 0.5, 2);
}

/** Choosing a preset clears every per-category override (scale/adaptive/fps are kept). */
export function choosePreset(saved, preset) {
  var s = saved || {};
  var out = { preset: PRESETS.indexOf(preset) >= 0 ? preset : 'auto' };
  if (s.render_scale != null) out.render_scale = clampScale(s.render_scale);
  if (s.adaptive === false) out.adaptive = false;
  if (s.show_fps) out.show_fps = true;
  return out;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  var row = TABLE[preset];
  return row ? row[cat] : undefined;
}

var EN_SUMMARY = {
  noShadows: 'no shadows', shadows: '{n}² shadows', ao: 'ambient occlusion', aoHigh: 'full ambient occlusion',
  bloom: 'bloom', reflections: 'reflections', noAA: 'no anti-aliasing', px: '{w}×{h} px'
};

/** One-line cost summary. `words` optionally localizes the fragments. */
export function describe(r, pixels, words) {
  var w = Object.assign({}, EN_SUMMARY, words || {});
  var parts = [
    r.shadows === 'off' ? w.noShadows : w.shadows.replace('{n}', SHADOW_MAP[r.shadows]),
    r.ao === 'off' ? null : (r.ao === 'high' ? w.aoHigh : w.ao),
    r.bloom === 'on' ? w.bloom : null,
    r.reflections === 'on' ? w.reflections : null,
    r.antialias === 'off' ? w.noAA : r.antialias.toUpperCase(),
    pixels ? w.px.replace('{w}', pixels[0]).replace('{h}', pixels[1]) : null
  ];
  return parts.filter(Boolean).join(' · ');
}
