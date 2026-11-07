// Sound, as the browser build's audio section in src/main.js: the authored
// one-shots (sfx/<name>.opus, sfx/manifest.json) per game event and the
// orchard ambience (white noise through a 320 Hz low-pass, its level swung
// by a 0.08 Hz LFO).
//
// The browser build's buses become the runtime's (Options › Audio owns the
// volumes and the mute): effects → "effects", the ambience plays on "music"
// (the runtime has no ambience bus); the old default bus levels (effects
// 80 %, ambience 40 %) are folded into each sound's gain. The ambience is
// rendered into a looping clip (OfflineAudioContext, from onStart): a live
// synthesis graph makes clip loads fail on the engine's web runtime.
// The synthesized stand-ins the browser build played while a sample was
// still decoding are not ported, so a sample still loading is silent. Every
// clip loads at once from onStart; the ambience starts once the mixer runs (natively
// at once, in a browser after the first press).
import { context, createClip, loadClip, OfflineAudioContext, play as playClip, type AudioClip, type Sound } from "starhermit:audio";

const LEVEL = { effects: 0.8, ambience: 0.4 };
const SAMPLES = [
  "ui-click", "fruit-drop", "fruit-thud", "merge-small", "merge-medium", "merge-large", "warn-alert",
  "invalid-action", "fanfare-win", "fanfare-lose", "countdown-tick", "countdown-go",
];

const clips = new Map<string, AudioClip>();
let suspended = false;

/** Loads every clip at once (onStart); a cue whose clip is still loading is silent. */
export function loadSfx(): void {
  for (const name of SAMPLES) {
    loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); }, (e: unknown) => { console.warn(`sfx ${name}: ${String(e)}`); });
  }
  renderAmbience().then((c) => { ambience = c; }, (e: unknown) => { console.warn(`audio: ${String(e)}`); });
}
/** A hidden window holds all sound. */
export function setSuspended(on: boolean): void { suspended = on; }

function sample(name: string): void {
  if (suspended) return;
  const clip = clips.get(name);
  if (!clip) return;
  try { playClip(clip, { bus: "effects", gain: LEVEL.effects }); }
  catch { /* the mixer is full this frame: skip it */ }
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
/** startAmbience: noise → biquad low-pass (320 Hz, Q 0.4, -7.96 dB as Web Audio reads it) → gain 0.12 ± 0.06
 * (LFO 0.08 Hz). One LFO period (12.5 s) rendered at 11025 Hz, sliced once the filter settled, then looped. */
const AMB_RATE = 11025, AMB_SECONDS = 12.5;
async function renderAmbience(): Promise<AudioClip> {
  const n = Math.round(AMB_RATE * AMB_SECONDS), settle = Math.round(AMB_RATE * AMB_SECONDS);
  const off = new OfflineAudioContext(1, settle + n, AMB_RATE);
  const noise = off.createNoise({ color: "white", seed: 0x2545f491, seconds: AMB_SECONDS });
  const lp = off.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 320; lp.Q.value = -7.96;
  const g = off.createGain(); g.gain.value = 0.12;
  const lfo = off.createOscillator(); lfo.frequency.value = 1 / AMB_SECONDS;
  const depth = off.createGain(); depth.gain.value = 0.06;
  lfo.connect(depth).connect(g.gain);
  noise.connect(lp).connect(g).connect(off.destination); noise.start(); lfo.start();
  const r = await off.startRendering();
  return createClip([r.getChannelData(0).slice(settle)], AMB_RATE);
}
let ambience: AudioClip | null = null;
let ambSound: Sound | null = null;

/** Each frame, once the mixer runs and the ambience is rendered: the loop by state. */
export function update(): void {
  if (context.state !== "running") return;
  if (!ambience) return;
  try {
    if (!suspended && !ambSound) ambSound = playClip(ambience, { bus: "music", gain: LEVEL.ambience, loop: true });
    else if (suspended && ambSound) { ambSound.stop(); ambSound = null; }
  } catch (e) { console.warn(`audio: ${String(e)}`); }
}
