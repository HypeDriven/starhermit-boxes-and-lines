/* Boxes & Lines — WebAudio: authored one-shot samples (sfx/*.opus, see
 * sfx/manifest.json) layered over procedural pencil strokes, paper folds,
 * desk knocks, quiet room ambience, and an adaptive music pad. Samples are
 * fetched lazily after the user-gesture unlock; synthesis remains the
 * fallback while a clip is loading or missing. Browser global: BLAudio.
 */
(function (root) {
  'use strict';

  var ctx = null, master = null;
  var buses = {}; // music, effects, ambience, voice
  var settings = { music: 0.55, effects: 0.9, ambience: 0.5, voice: 0.8, muted: false };
  var captions = false;
  var captionFn = null;
  var started = false;
  var musicTimer = null, ambienceNodes = null;
  var avRng = null; // seeded variants for replay consistency

  function ensureCtx() {
    if (ctx) return true;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    ['music', 'effects', 'ambience', 'voice'].forEach(function (name) {
      var g = ctx.createGain();
      g.gain.value = settings.muted ? 0 : (settings[name] != null ? settings[name] : 0.8);
      g.connect(master);
      buses[name] = g;
    });
    return true;
  }

  function applySettings(s) {
    Object.assign(settings, s || {});
    if (!ctx) return;
    Object.keys(buses).forEach(function (name) {
      var v = settings.muted ? 0 : (settings[name] != null ? settings[name] : 0.8);
      buses[name].gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    });
  }

  function caption(text) {
    if (captions && captionFn && text) captionFn(text);
  }

  // ---------- primitive builders ----------
  function blip(freq, dur, type, gain, bus, when, sweepTo) {
    var t = (when || ctx.currentTime);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(buses[bus || 'effects']);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noiseBurst(dur, gain, cutoff, bus, when, q) {
    var t = (when || ctx.currentTime);
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = cutoff; f.Q.value = q || 0.9;
    var g = ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(buses[bus || 'effects']);
    src.start(t);
  }

  function variant(base) { // seeded pitch variant (±6%) when replay consistency matters
    if (!avRng) return base;
    return base * (0.94 + avRng.next() * 0.12);
  }

  // pencil stroke: short filtered noise scratch + faint graphite tick
  function pencilStroke() {
    noiseBurst(0.09, 0.4, 2600, 'effects', ctx.currentTime, 0.7);
    noiseBurst(0.05, 0.2, 4200, 'effects', ctx.currentTime + 0.05, 1.1);
    blip(variant(1800), 0.03, 'triangle', 0.03);
  }

  // paper fold: soft thump + rising page rustle
  function paperFold(when) {
    var t = when || ctx.currentTime;
    noiseBurst(0.16, 0.3, 700, 'effects', t, 0.6);
    blip(220, 0.14, 'sine', 0.1, 'effects', t, 340);
  }

  var EVENTS = {
    'ui':        function () { blip(660, 0.06, 'triangle', 0.12); },
    'hover':     function () { blip(variant(1200), 0.03, 'sine', 0.04); },
    'select':    function () { blip(variant(520), 0.09, 'sine', 0.16); blip(variant(780), 0.07, 'sine', 0.07, 'effects', ctx.currentTime + 0.03); caption('select'); },
    'draw':      function () { pencilStroke(); caption('line drawn'); },
    'danger':    function () { pencilStroke(); blip(240, 0.18, 'sine', 0.08, 'effects', ctx.currentTime + 0.05, 170); caption('risky line'); },
    'box':       function () {
      paperFold();
      [0, 4, 7].forEach(function (st, i) {
        blip(variant(523 * Math.pow(2, st / 12)), 0.16, 'triangle', 0.12, 'effects', ctx.currentTime + 0.05 + i * 0.06);
      });
      caption('box claimed');
    },
    'box-rival': function () { paperFold(); blip(330, 0.2, 'sine', 0.1, 'effects', ctx.currentTime + 0.04, 260); caption('rival claimed a box'); },
    'extra':     function () { blip(variant(880), 0.1, 'triangle', 0.08); caption('extra turn'); },
    'invalid':   function () { blip(160, 0.16, 'square', 0.06); blip(150, 0.14, 'square', 0.05, 'effects', ctx.currentTime + 0.05); caption('not allowed'); },
    'win':       function () {
      [0, 4, 7, 12].forEach(function (st, i) {
        blip(523 * Math.pow(2, st / 12), 0.3, 'triangle', 0.13, 'effects', ctx.currentTime + i * 0.12);
      });
      paperFold(ctx.currentTime + 0.1);
      caption('you win');
    },
    'lose':      function () { blip(300, 0.5, 'sine', 0.14, 'effects', ctx.currentTime, 180); blip(200, 0.6, 'sine', 0.1, 'effects', ctx.currentTime + 0.15, 120); caption('match lost'); },
    'drawn-game':function () { blip(440, 0.35, 'sine', 0.1); blip(440, 0.35, 'sine', 0.08, 'effects', ctx.currentTime + 0.2); caption('a tie'); },
    'undo':      function () { blip(500, 0.08, 'triangle', 0.1, 'effects', ctx.currentTime, 380); caption('undo'); },
    'hint':      function () { blip(990, 0.12, 'sine', 0.09); blip(1320, 0.14, 'sine', 0.06, 'effects', ctx.currentTime + 0.07); caption('hint'); },
    'turn':      function () { blip(variant(700), 0.05, 'sine', 0.05); },
    'star':      function () { blip(1568, 0.18, 'sine', 0.1); },
    'tick':      function () { blip(1050, 0.04, 'sine', 0.05); caption('clock low'); }
  };

  // ---------- authored samples: lazy fetch/decode/cache of sfx/<name>.opus ----------
  // event name -> clip basename (must match sfx/manifest.json)
  var SAMPLES = {
    'ui': 'ui-tap', 'hover': 'pencil-hover', 'select': 'menu-select',
    'draw': 'pencil-line', 'danger': 'pencil-press', 'box': 'box-fold',
    'box-rival': 'rival-box', 'extra': 'extra-turn', 'invalid': 'eraser-thump',
    'win': 'win-slap', 'lose': 'page-drop', 'drawn-game': 'tie-tap',
    'undo': 'erase-line', 'hint': 'hint-tap', 'turn': 'turn-tap',
    'star': 'star-chime', 'tick': 'clock-tick'
  };
  // captions for the sample path (synthesis events carry their own)
  var SAMPLE_CAPTIONS = {
    'select': 'select', 'draw': 'line drawn', 'danger': 'risky line',
    'box': 'box claimed', 'box-rival': 'rival claimed a box', 'extra': 'extra turn',
    'invalid': 'not allowed', 'win': 'you win', 'lose': 'match lost',
    'drawn-game': 'a tie', 'undo': 'undo', 'hint': 'hint', 'tick': 'clock low'
  };
  var sampleBufs = {};  // basename -> AudioBuffer
  var sampleState = {}; // basename -> 'loading' | 'ready' | 'failed'

  function loadSample(name) {
    if (!ctx || sampleState[name]) return;
    sampleState[name] = 'loading';
    fetch('sfx/' + name + '.opus').then(function (res) {
      if (!res.ok) throw new Error('http ' + res.status);
      return res.arrayBuffer();
    }).then(function (data) {
      return ctx.decodeAudioData(data);
    }).then(function (buf) {
      sampleBufs[name] = buf;
      sampleState[name] = 'ready';
    }).catch(function () {
      sampleState[name] = 'failed'; // missing/undecodable clip: keep synthesis
    });
  }

  function playSample(name) {
    var src = ctx.createBufferSource();
    src.buffer = sampleBufs[name];
    src.connect(buses.effects);
    src.start();
  }

  function play(name) {
    if (!started || !ctx || settings.muted) return;
    var fn = EVENTS[name];
    if (!fn) return;
    var sample = SAMPLES[name];
    if (sample) {
      if (sampleState[sample] === 'ready') {
        playSample(sample);
        caption(SAMPLE_CAPTIONS[name]);
        return;
      }
      loadSample(sample); // kick off fetch; synthesize until ready
    }
    fn();
  }

  // ---------- ambience: quiet room tone (looped filtered noise) ----------
  function startAmbience() {
    if (!ctx || ambienceNodes) return;
    var len = ctx.sampleRate * 2;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var last = 0;
    for (var i = 0; i < len; i++) { // brown-ish noise
      var w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    var src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 320;
    var g = ctx.createGain(); g.gain.value = 0.16;
    src.connect(f); f.connect(g); g.connect(buses.ambience);
    src.start();
    ambienceNodes = { src: src, gain: g };
  }

  // ---------- music: slow generative pad over a warm pentatonic ----------
  var PAD_ROOT = 196; // G3
  var PAD_STEPS = [0, 3, 5, 7, 10, 12, 15];
  var padStep = 0;
  function schedulePad() {
    if (!ctx || !started) return;
    var rng = avRng || { next: Math.random };
    var chordRoot = PAD_ROOT * Math.pow(2, PAD_STEPS[padStep % PAD_STEPS.length] / 12);
    padStep += 1 + Math.floor(rng.next() * 3);
    var dur = 3.2;
    [1, 1.5, 2].forEach(function (mult, i) {
      var t = ctx.currentTime + i * 0.04;
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = chordRoot * mult * (1 + (rng.next() - 0.5) * 0.004);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05 / (i + 1), t + dur * 0.4);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(buses.music);
      o.start(t); o.stop(t + dur + 0.1);
    });
    musicTimer = setTimeout(schedulePad, dur * 800);
  }

  function start(opts) {
    if (started) { if (ctx && ctx.state === 'suspended') ctx.resume(); return; }
    if (!ensureCtx()) return;
    started = true;
    applySettings(opts && opts.settings || {});
    if (ctx.state === 'suspended') ctx.resume();
    startAmbience();
    schedulePad();
    // user gesture has unlocked audio: start fetching authored clips in
    // the background so later plays prefer samples over synthesis
    Object.keys(SAMPLES).forEach(function (ev) { loadSample(SAMPLES[ev]); });
  }

  function suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); }
  function resume() { if (ctx && started && ctx.state === 'suspended') ctx.resume(); }

  function setAvRng(rng) { avRng = rng; }
  function setCaptions(on, fn) { captions = !!on; captionFn = fn || captionFn; }

  root.BLAudio = {
    start: start, play: play, applySettings: applySettings,
    suspend: suspend, resume: resume,
    setAvRng: setAvRng, setCaptions: setCaptions,
    isStarted: function () { return started; }
  };
})(typeof self !== 'undefined' ? self : this);
