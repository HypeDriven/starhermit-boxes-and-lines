/* Boxes & Lines — Graphics section of the Settings screen.
 * Quality preset (Auto/Low/Balanced/High/Ultra), render scale, one select per
 * effect category ("From preset (…)" by default), adaptive resolution, frame
 * rate readout, and a "GPU · cost · W×H px" summary. Changes apply live and
 * persist through api.save(). Controls carry stable ids for tests.
 */
import { PRESETS, CATEGORIES, resolve, presetTier, choosePreset, describe, clampScale, detectPreset } from './gfx.js';
import { gfxStrings } from './gfx-strings.js';

function h(tag, attrs, kids) {
  var n = document.createElement(tag);
  Object.keys(attrs || {}).forEach(function (k) {
    if (k === 'text') n.textContent = attrs[k];
    else n.setAttribute(k, attrs[k]);
  });
  (kids || []).forEach(function (c) { n.appendChild(c); });
  return n;
}

/**
 * api: { get(): saved graphics object, save(saved): persist + apply,
 *        info(): renderer.graphicsInfo() or null when 3D is unavailable }
 */
export function buildGraphicsPanel(host, api) {
  var S = gfxStrings(navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]);
  var info = api.info();
  var detected = info ? info.detected : detectPreset('');
  var tierName = function (t) { return S.tier[t] || t; };

  var root = h('div', { id: 'gfx-section', class: 'gfx-section' });

  function row(label, control, id) {
    var wrap = h('label', { class: 'setting-row', for: id });
    wrap.appendChild(h('span', { text: label }));
    wrap.appendChild(control);
    return wrap;
  }

  // Quality preset
  var presetSel = h('select', { id: 'gfx-preset', 'data-gfx': 'preset', 'aria-label': S.quality });
  root.appendChild(row(S.quality, presetSel, 'gfx-preset'));

  // Render scale
  var scaleWrap = h('span', { class: 'gfx-scale' });
  var scale = h('input', { id: 'gfx-scale', 'data-gfx': 'render_scale', type: 'range', min: '50', max: '200', step: '5', 'aria-label': S.renderScale });
  var scaleOut = h('output', { id: 'gfx-scale-value', for: 'gfx-scale' });
  scaleWrap.appendChild(scale);
  scaleWrap.appendChild(scaleOut);
  root.appendChild(row(S.renderScale, scaleWrap, 'gfx-scale'));

  // Category overrides
  var catSels = {};
  Object.keys(CATEGORIES).forEach(function (cat) {
    var sel = h('select', { id: 'gfx-' + cat, 'data-gfx': cat, 'aria-label': S.cat[cat] || cat });
    catSels[cat] = sel;
    root.appendChild(row(S.cat[cat] || cat, sel, 'gfx-' + cat));
  });

  var adaptive = h('input', { id: 'gfx-adaptive', 'data-gfx': 'adaptive', type: 'checkbox', 'aria-label': S.adaptive });
  root.appendChild(row(S.adaptive, adaptive, 'gfx-adaptive'));
  var fps = h('input', { id: 'gfx-fps', 'data-gfx': 'show_fps', type: 'checkbox', 'aria-label': S.showFps });
  root.appendChild(row(S.showFps, fps, 'gfx-fps'));

  var summary = h('p', { id: 'gfx-summary', class: 'gfx-summary dim' });
  var note = h('p', { id: 'gfx-note', class: 'gfx-note', role: 'note' });
  note.hidden = true;
  root.appendChild(summary);
  root.appendChild(note);

  function fill(sel, opts, value) {
    sel.innerHTML = '';
    opts.forEach(function (o) {
      var op = h('option', { value: o[0], text: o[1] });
      if (o[0] === value) op.selected = true;
      sel.appendChild(op);
    });
    sel.value = value;
  }

  function refresh() {
    var saved = api.get();
    var r = resolve(saved, detected);
    var presetValue = PRESETS.indexOf(saved.preset) >= 0 ? saved.preset : 'auto';
    fill(presetSel, [['auto', S.auto.replace('{tier}', tierName(detected))]].concat(
      PRESETS.map(function (p) { return [p, tierName(p)]; })), presetValue);
    var pct = Math.round(clampScale(saved.render_scale) * 100);
    scale.value = String(pct);
    scaleOut.textContent = pct + '%';
    Object.keys(CATEGORIES).forEach(function (cat) {
      var own = presetTier(r.preset, cat);
      var val = CATEGORIES[cat].indexOf(saved[cat]) >= 0 ? saved[cat] : 'preset';
      fill(catSels[cat], [['preset', S.fromPreset.replace('{tier}', tierName(own))]].concat(
        CATEGORIES[cat].map(function (t) { return [t, tierName(t)]; })), val);
    });
    adaptive.checked = r.adaptive;
    fps.checked = r.showFps;
    updateSummary();
  }

  function updateSummary() {
    var i = api.info();
    var r = i ? i.resolved : resolve(api.get(), detected);
    if (!i) {
      summary.textContent = S.unavailable + ' · ' + describe(r, null, S.summary);
    } else {
      var parts = [i.gpu || S.unknownGpu, describe(r, i.pixels[0] ? i.pixels : null, S.summary)];
      if (r.showFps && i.fps) parts.push(i.fps + ' fps');
      summary.textContent = parts.join(' · ');
    }
    note.textContent = S.postFailed;
    note.hidden = !(i && i.postFailed);
  }

  function commit(next) {
    api.save(next);
    refresh();
  }

  presetSel.addEventListener('change', function () {
    commit(choosePreset(api.get(), presetSel.value)); // a preset clears overrides
  });
  scale.addEventListener('input', function () {
    scaleOut.textContent = scale.value + '%';
    var s = Object.assign({}, api.get());
    s.render_scale = clampScale(Number(scale.value) / 100);
    api.save(s);
    updateSummary();
  });
  Object.keys(catSels).forEach(function (cat) {
    catSels[cat].addEventListener('change', function () {
      var s = Object.assign({}, api.get());
      if (catSels[cat].value === 'preset') delete s[cat];
      else s[cat] = catSels[cat].value;
      commit(s);
    });
  });
  adaptive.addEventListener('change', function () {
    var s = Object.assign({}, api.get());
    if (adaptive.checked) delete s.adaptive; else s.adaptive = false;
    commit(s);
  });
  fps.addEventListener('change', function () {
    var s = Object.assign({}, api.get());
    if (fps.checked) s.show_fps = true; else delete s.show_fps;
    commit(s);
  });

  // Keep the summary (resolution, adaptive scale, fps) current while the panel is open.
  var timer = setInterval(function () {
    if (!root.isConnected) { clearInterval(timer); return; }
    updateSummary();
  }, 1000);

  refresh();
  host.appendChild(root);
  return { refresh: refresh };
}
