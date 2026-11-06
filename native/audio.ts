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
// The room tone and the pad's swells are offline graphs rendered once into
// clips, with the shapes the browser build's Web Audio graphs had. The
// synthesized stand-ins it played while a sample loaded are not ported. The
// one-shot clips and the renders all start in onStart; the beds start once the
// mixer runs (in a browser after the first press).
import { OfflineAudioContext, context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";

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

/** Loads every clip at once (onStart); a cue whose clip is still loading is skipped. */
export function loadSfx(): void {
  for (const name of new Set(Object.values(SAMPLES))) {
    loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); }, (e: unknown) => console.warn(`sfx ${name}: ${String(e)}`));
  }
  renderRoom().then((c) => { roomTone = c; }, (e: unknown) => console.warn(`beds: ${String(e)}`));
  Promise.all(PAD_STEPS.map((_, i) => renderPad(i))).then((list) => { pads = list; }, (e: unknown) => console.warn(`beds: ${String(e)}`));
}
export function setOnCaption(cb: (key: string) => void): void { onCaption = cb; }
export function setAvRng(rng: { next(): number } | null): void { avRng = rng; }

/** Plays an event's clip and emits its caption. */
export function play(name: string): void {
  if (CAPTIONS[name] && onCaption) onCaption(CAPTIONS[name]!);
  const file = SAMPLES[name];
  const clip = file ? clips.get(file) : undefined;
  if (!clip) return;
  try { playClip(clip, { bus: name === "ui" ? "interface" : "effects", gain: LEVEL.effects }); }
  catch { /* the mixer is full this frame: skip it */ }
}

// -- rendered beds ------------------------------------------------------------------------
const RATE = 11025;
const ROOM_GAIN = 0.153; // measured: the browser build's rms 0.0298 (its noise was quieter than the engine's brown)
/** The room tone: brown noise looping every 6 s, low-passed at 320 Hz. A filtered
 * periodic noise is periodic once settled, so the loop has no seam. */
async function renderRoom(): Promise<AudioClip> {
  const n = 6 * RATE, settle = Math.round(0.25 * RATE);
  const off = new OfflineAudioContext(1, settle + n, RATE);
  const noise = off.createNoise({ color: "brown", seed: 0xb0e5, seconds: 6 });
  const lp = off.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 320; lp.Q.value = -3.01; // dB: linear Q 0.707
  const g = off.createGain();
  g.gain.value = ROOM_GAIN;
  noise.connect(lp).connect(g).connect(off.destination);
  noise.start();
  const r = await off.startRendering();
  return createClip([r.getChannelData(0).slice(settle)], RATE);
}
const PAD_ROOT = 196; // G3
const PAD_STEPS = [0, 3, 5, 7, 10, 12, 15];
const PAD_DUR = 3.2;
/** One swell: sines at 1×, 1.5× and 2× the root, each rising to 0.05/(i+1)
 * over 40 % of 3.2 s and falling to silence by the end, 40 ms apart. */
async function renderPad(step: number): Promise<AudioClip> {
  const root = PAD_ROOT * Math.pow(2, PAD_STEPS[step]! / 12);
  const off = new OfflineAudioContext(1, Math.round((PAD_DUR + 0.2) * RATE), RATE);
  [1, 1.5, 2].forEach((mult, v) => {
    const t0 = v * 0.04, peak = 0.05 / (v + 1);
    const osc = off.createOscillator();
    osc.frequency.value = root * mult;
    const g = off.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + PAD_DUR * 0.4);
    g.gain.linearRampToValueAtTime(0, t0 + PAD_DUR);
    osc.connect(g).connect(off.destination);
    osc.start(t0); osc.stop(t0 + PAD_DUR);
  });
  return createClip(await off.startRendering());
}

let started = false;
let paused = false;
let room: Sound | null = null;
let roomTone: AudioClip | null = null;
let pads: AudioClip[] = [];
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

/** Each frame once the mixer runs and the renders are done: the room tone,
 * then the pad's next swell every 2.56 s of mixer time. */
export function update(): void {
  if (context.state !== "running" || !started) return; // starting the beds still waits for the mixer
  if (!roomTone || !pads.length) return;
  try {
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
