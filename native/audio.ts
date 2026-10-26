// Sound, as the browser build's js/audio.js: the authored one-shots
// (sfx/<name>.opus, the event table of sfx/manifest.txt) on the runtime's
// mixer, with the quiet room tone (brown noise through a 320 Hz low-pass)
// and the slow generative pad over a G3 pentatonic set (3.2 s swells every
// ~2.6 s, the next step 1–3 notes on, from the seeded AV stream when a sheet
// set one). Every captioned event also emits a caption (setOnCaption).
//
// The browser build's four buses become the runtime's (Options › Audio owns
// the volumes, the mute and the voice limit): music → "music", effects and
// ambience → "effects", the Skip tap → "interface". The old default bus
// levels (music 55 %, effects 90 %, ambience 50 %) are folded into each
// sound's gain.
//
// The room tone and the pad's swells were Web Audio graphs; here they are
// rendered once into clips (createClip) with the same shapes, a clip per
// frame. The synthesized stand-ins the browser build played while a sample
// loaded are not ported: the engine's browser runtime drops clip loads and
// plays while a synthesis graph changes (the arrow-exodus port's finding).
// Clips load one at a time once the mixer runs (natively at once, in a
// browser after the first press): a burst of loads closes the browser's
// audio port (the blade-orbit port's finding).
import { context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";

const LEVEL = { music: 0.55, effects: 0.9, ambience: 0.5 };
// Event → clip basename (sfx/manifest.json).
const SAMPLES: Record<string, string> = {
  ui: "ui-tap", hover: "pencil-hover", select: "menu-select",
  draw: "pencil-line", danger: "pencil-press", box: "box-fold",
  "box-rival": "rival-box", extra: "extra-turn", invalid: "eraser-thump",
  win: "win-slap", lose: "page-drop", "drawn-game": "tie-tap",
  undo: "erase-line", hint: "hint-tap", turn: "turn-tap",
  star: "star-chime", tick: "clock-tick",
  page: "page-turn", chain: "chain-flurry", pause: "pencil-down",
};
/** Caption keys (English, translated by the caller) per event. */
export const CAPTIONS: Record<string, string> = {
  select: "select", draw: "line drawn", danger: "risky line",
  box: "box claimed", "box-rival": "rival claimed a box", extra: "extra turn",
  invalid: "not allowed", win: "you win", lose: "match lost",
  "drawn-game": "a tie", undo: "undo", hint: "hint", tick: "clock low",
  chain: "chain!", pause: "paused",
};

const clips = new Map<string, AudioClip>();
let onCaption: ((key: string) => void) | null = null;
let avRng: { next(): number } | null = null;
let wantClips = false;
let loading = false;
const queue: string[] = [];

function loadNext(): void {
  const name = queue.shift();
  if (!name) { loading = false; return; }
  loading = true;
  loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); }, (e: unknown) => console.warn(`sfx ${name}: ${String(e)}`))
    .finally(() => loadNext());
}
/** Asks for the clips; they load once the mixer runs (see update). */
export function loadSfx(): void { wantClips = true; }
export function setOnCaption(cb: (key: string) => void): void { onCaption = cb; }
export function setAvRng(rng: { next(): number } | null): void { avRng = rng; }

/** Plays an event's clip and emits its caption. */
export function play(name: string): void {
  if (CAPTIONS[name] && onCaption) onCaption(CAPTIONS[name]!);
  const file = SAMPLES[name];
  const clip = file ? clips.get(file) : undefined;
  if (!clip) return;
  try { playClip(clip, { bus: name === "ui" ? "interface" : "effects", gain: LEVEL.effects }); }
  catch { clips.delete(file!); queue.push(file!); if (!loading) loadNext(); } // a clip the mixer lost: load it again
}

// -- rendered beds ------------------------------------------------------------------------
const RATE = 11025;
/** RBJ biquad lowpass over `x` in place (Web Audio's BiquadFilterNode, Q ≈ 0.707). */
function lowpass(x: Float32Array, freq: number, q = Math.SQRT1_2): void {
  const w = (2 * Math.PI * freq) / RATE, alpha = Math.sin(w) / (2 * q), c = Math.cos(w);
  const a0 = 1 + alpha;
  const b0 = (1 - c) / 2 / a0, b1 = (1 - c) / a0, b2 = b0, a1 = (-2 * c) / a0, a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i]!;
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    x[i] = y0;
  }
}
/** The room tone: 6 s of brown noise, low-passed at 320 Hz at 0.16, its ends
 * cross-faded so the loop has no seam. */
function roomClip(): AudioClip {
  const n = 6 * RATE, fade = RATE;
  const raw = new Float32Array(n + fade);
  let last = 0;
  for (let i = 0; i < raw.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    raw[i] = last * 3.5;
  }
  lowpass(raw, 320);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = raw[i]! * 0.16;
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    out[i] = (raw[i]! * k + raw[n + i]! * (1 - k)) * 0.16;
  }
  return createClip([out], RATE);
}
const PAD_ROOT = 196; // G3
const PAD_STEPS = [0, 3, 5, 7, 10, 12, 15];
const PAD_DUR = 3.2;
/** One swell: sines at 1×, 1.5× and 2× the root, each rising to 0.05/(i+1)
 * over 40 % of 3.2 s and falling to silence by the end, 40 ms apart. */
function padClip(step: number): AudioClip {
  const root = PAD_ROOT * Math.pow(2, PAD_STEPS[step]! / 12);
  const n = Math.round((PAD_DUR + 0.2) * RATE);
  const out = new Float32Array(n);
  [1, 1.5, 2].forEach((mult, v) => {
    const f = root * mult, t0 = v * 0.04, peak = 0.05 / (v + 1);
    for (let i = 0; i < n; i++) {
      const t = i / RATE - t0;
      if (t < 0 || t > PAD_DUR) continue;
      const env = t < PAD_DUR * 0.4 ? peak * (t / (PAD_DUR * 0.4)) : peak * (1 - (t - PAD_DUR * 0.4) / (PAD_DUR * 0.6));
      out[i]! += Math.sin(2 * Math.PI * f * t) * env;
    }
  });
  return createClip([out], RATE);
}

let started = false;
let paused = false;
let room: Sound | null = null;
let roomTone: AudioClip | null = null;
const pads: AudioClip[] = [];
let padStep = 0;
let nextPad = 0;

/** The beds start with the first press (the browser build's BLAudio.start). */
export function start(): void { started = true; }
/** Pause or a hidden window: the beds hold (the browser build suspended its context). */
export function setPaused(on: boolean): void {
  paused = on;
  if (!room) return;
  try { room.fade(on ? 0 : LEVEL.ambience, 0.3); } catch { room = null; }
}

/** Each frame: what waited for the mixer, one rendered clip a frame, then
 * the pad's next swell every 2.56 s of mixer time. */
export function update(): void {
  if (context.state !== "running") return;
  if (wantClips) {
    wantClips = false;
    queue.push(...new Set(Object.values(SAMPLES)));
    if (!loading) loadNext();
    return;
  }
  if (!started) return;
  try {
    if (!roomTone) { roomTone = roomClip(); return; }
    if (pads.length < PAD_STEPS.length) { pads.push(padClip(pads.length)); return; }
    if (!room) { room = playClip(roomTone, { bus: "effects", gain: paused ? 0 : LEVEL.ambience, loop: true }); return; }
  } catch (e) { console.warn(`beds: ${String(e)}`); started = false; return; }
  if (paused) return;
  const now = context.currentTime;
  if (now >= nextPad) {
    nextPad = now + PAD_DUR * 0.8;
    const r = avRng ? avRng.next() : Math.random();
    try { playClip(pads[padStep % PAD_STEPS.length]!, { bus: "music", gain: LEVEL.music }); } catch { /* the mixer is full */ }
    padStep += 1 + Math.floor(r * 3);
  }
}
