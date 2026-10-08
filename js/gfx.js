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
  balanced: { scale: 1,    shadows: 'low',    ao: 'off',  bloom: 'on',  grade: 'on',  antialias: 'fxaa', reflections: 'on',  detail: 'detailed', particles: 'high', ambient: 'animated' },
  high:     { scale: 1,    shadows: 'medium', ao: 'on',   bloom: 'on',  grade: 'on',  antialias: 'smaa', reflections: 'on',  detail: 'detailed', particles: 'high', ambient: 'animated' },
  ultra:    { scale: 1.25, shadows: 'high',   ao: 'high', bloom: 'on',  grade: 'on',  antialias: 'msaa', reflections: 'on',  detail: 'detailed', particles: 'high', ambient: 'animated' }
};

export var SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };
export var PARTICLE_BUDGET = { low: 80, high: 300 };

/** Best preset for this GPU (unmasked renderer string). Touch/mobile devices are capped at balanced. */
export function detectPreset(gpu, mobile) {
  var g = String(gpu || '').toLowerCase();
  var p;
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(g)) p = 'low';
  else if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|amd radeon(?!.*graphics)|apple m\d/.test(g)) p = 'high';
  else p = 'balanced';
  if (mobile && p !== 'low') p = 'balanced';
  return p;
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

/**
 * Resolve saved settings into concrete tiers.
 * saved: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected) {
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
