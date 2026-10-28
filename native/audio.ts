// Sound, as the browser build's audio section in src/main.js: the authored
// one-shots (sfx/<name>.opus, sfx/manifest.json) per game event and the
// orchard ambience (white noise through a 320 Hz low-pass, its level swung
// by a 0.08 Hz LFO).
//
// The browser build's buses become the runtime's (Options › Audio owns the
// volumes and the mute): effects → "effects", the ambience plays on "music"
// (the runtime has no ambience bus); the old default bus levels (effects
// 80 %, ambience 40 %) are folded into each sound's gain. The ambience is
// rendered into a looping clip (createClip, in slices over several frames):
// a live synthesis graph makes clip loads fail on the engine's web runtime.
// The synthesized stand-ins the browser build played while a sample was
// still decoding are not ported, so a sample still loading is silent. Clips
// load once the mixer runs (natively at once, in a browser after the first
// press), one at a time.
import { context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";

const LEVEL = { effects: 0.8, ambience: 0.4 };
const SAMPLES = [
  "ui-click", "fruit-drop", "fruit-thud", "merge-small", "merge-medium", "merge-large", "warn-alert",
  "invalid-action", "fanfare-win", "fanfare-lose", "countdown-tick", "countdown-go",
];

const clips = new Map<string, AudioClip>();
const queue: string[] = [];
let loading = false;
let wantClips = false;
let suspended = false;

function load(name: string): void { if (!queue.includes(name) && !clips.has(name)) queue.push(name); }
function pump(): void {
  if (loading || !queue.length) return;
  const name = queue.shift()!;
  loading = true;
  loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); loading = false; }, (e: unknown) => { console.warn(`sfx ${name}: ${String(e)}`); loading = false; });
}
/** Asks for the clips; they load once the mixer runs (see update). */
export function loadSfx(): void { wantClips = true; }
/** A hidden window holds all sound. */
export function setSuspended(on: boolean): void { suspended = on; }

function sample(name: string): void {
  if (suspended) return;
  const clip = clips.get(name);
  if (!clip) return;
  try { playClip(clip, { bus: "effects", gain: LEVEL.effects }); }
  catch { clips.delete(name); load(name); } // a clip the mixer lost: load it again
}
export const sfx = {
  click: (): void => sample("ui-click"),
  drop: (): void => sample("fruit-drop"),
  merge: (tier: number): void => sample(tier <= 3 ? "merge-small" : tier <= 6 ? "merge-medium" : "merge-large"),
  warn: (): void => sample("warn-alert"),
  invalid: (): void => sample("invalid-action"),
  fanfare: (win: boolean): void => sample(win ? "fanfare-win" : "fanfare-lose"),
  countdown: (n: number): void => sample(n === 0 ? "countdown-go" : "countdown-tick"),
};

// -- the ambience ---------------------------------------------------------------------------------
/** startAmbience: noise → biquad low-pass (320 Hz, Q 0.4) → gain 0.12 ± 0.06 (LFO 0.08 Hz). One LFO period
 * (12.5 s) rendered at 11025 Hz, 22050 samples a frame, then looped. */
const AMB_RATE = 11025, AMB_SECONDS = 12.5;
let ambData: Float32Array | null = null;
let ambDone = 0;
let seed = 0x2545f491;
const lp = { b0: 0, b1: 0, b2: 0, a1: 0, a2: 0, x1: 0, x2: 0, y1: 0, y2: 0 };
{
  // RBJ cookbook low-pass, as the Web Audio BiquadFilterNode computes it.
  const w0 = 2 * Math.PI * 320 / AMB_RATE, alpha = Math.sin(w0) / (2 * 0.4), cw = Math.cos(w0), a0 = 1 + alpha;
  lp.b0 = (1 - cw) / 2 / a0; lp.b1 = (1 - cw) / a0; lp.b2 = lp.b0; lp.a1 = -2 * cw / a0; lp.a2 = (1 - alpha) / a0;
}
function ambienceSlice(): AudioClip | null {
  const n = Math.round(AMB_RATE * AMB_SECONDS);
  if (!ambData) ambData = new Float32Array(n);
  const end = Math.min(n, ambDone + 22050);
  for (let i = ambDone; i < end; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const x = seed / 2147483648 - 1;
    const y = lp.b0 * x + lp.b1 * lp.x1 + lp.b2 * lp.x2 - lp.a1 * lp.y1 - lp.a2 * lp.y2;
    lp.x2 = lp.x1; lp.x1 = x; lp.y2 = lp.y1; lp.y1 = y;
    const g = 0.12 + 0.06 * Math.sin(2 * Math.PI * (i / AMB_RATE) / AMB_SECONDS);
    ambData[i] = y * g;
  }
  ambDone = end;
  if (ambDone < n) return null;
  const clip = createClip([ambData], AMB_RATE);
  ambData = null;
  return clip;
}
let ambience: AudioClip | null = null;
let ambSound: Sound | null = null;

/** Each frame: the samples once the mixer runs (one at a time), then the ambience clip, then the loop by state. */
export function update(): void {
  if (context.state !== "running") return;
  if (wantClips) {
    wantClips = false;
    for (const n of SAMPLES) load(n);
    return;
  }
  pump();
  if (loading || queue.length) return;
  if (!ambience) { ambience = ambienceSlice(); return; }
  try {
    if (!suspended && !ambSound) ambSound = playClip(ambience, { bus: "music", gain: LEVEL.ambience, loop: true });
    else if (suspended && ambSound) { ambSound.stop(); ambSound = null; }
  } catch (e) { console.warn(`audio: ${String(e)}`); }
}
