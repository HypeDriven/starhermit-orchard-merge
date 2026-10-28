// Orchard Merge — the game's content and save model (pure; shared by the
// engine client in native/ and the Node tests). Moved out of the browser
// build's src/main.js unchanged in meaning: the fruit tiers and palettes, the
// journey stages, the challenges, the achievements, the save document and its
// readers (this device's save, the browser build's cloud document).
import { N } from './i18n.js';
import { mergeSaves } from './save-merge.js';

export const SAVE_VERSION = 1;

// Distinct colour per tier; the marker is the number of little leaves (colour-blind-safe cue).
export const PALETTES = {
  default:      [null, '#ff5a5a', '#ff9440', '#ffd23f', '#a3e048', '#37c871', '#34c6c9', '#4d8dff', '#8a6fe8', '#d96bd0', '#ff7ab0'],
  citrus:       [null, '#e8483f', '#f27038', '#f79d2f', '#ffb627', '#ffd23f', '#f4e04d', '#a8c256', '#6a9c59', '#3e7c4f', '#2f5d3a'],
  pastel:       [null, '#f4a9b8', '#f6bd97', '#f9e29c', '#c8e6a0', '#9dd8b0', '#a0d8d8', '#a3c4f3', '#b8a9e8', '#d8b4e2', '#efb9d4'],
  'night-orchard': [null, '#b33951', '#c2543a', '#d07a2e', '#d69f2d', '#b8b52e', '#7fb069', '#3d9971', '#2f7f8f', '#3a5fa8', '#5a3d8f'],
  deuteranopia: [null, '#d55e00', '#e69f00', '#f0e442', '#009e73', '#56b4e9', '#0072b2', '#332288', '#cc79a7', '#88ccee', '#ffffff'],
};
export const PALETTE_NAMES = [
  ['default', N('Default')], ['citrus', N('Citrus')], ['pastel', N('Pastel')],
  ['night-orchard', N('Night orchard')], ['deuteranopia', N('Deuteranopia-safe')],
];
// Fruit names are keys; translate at display time.
export const TIER_NAMES = [null, N('Cherry'), N('Strawberry'), N('Plum'), N('Orange'), N('Apple'), N('Pear'), N('Peach'), N('Grapefruit'), N('Melon'), N('Pumpkin')];

// A small static achievement set: first completion, mechanic mastery, a sustained streak,
// a difficult content milestone and a long-term goal. Keys are stable; unlocks are idempotent.
export const ACHIEVEMENTS = {
  'first-completion': N('First harvest — complete any run'),
  'merge-master': N('Mechanic mastery — merge up to tier 8'),
  'daily-streak-3': N('Regular picker — play the daily on 3 different days'),
  'journey-complete': N('Milestone — clear journey stage 40'),
  'orchard-keeper': N('Long game — 25,000 lifetime points'),
};

/** Journey: 40 authored stages, deterministic from the index (hashStr is the rules' djb2). */
export function journeyStage(i, hashStr) {
  const seed = hashStr('journey-' + i);
  const targetScore = 200 + i * 160;
  const requireTier = Math.min(3 + Math.floor(i / 6), 8);
  const maxDrops = 40 + Math.floor(i * 1.5);
  return { i, seed, goals: { targetScore, requireTier, maxDrops },
    difficulty: i < 12 ? 'easy' : i < 28 ? 'normal' : 'hard' };
}
export const JOURNEY_COUNT = 40;

export const CHALLENGES = [
  { id: 'move-limit', name: N('Move limit'), desc: N('Reach 1200 points in at most 25 drops.'),
    goals: { targetScore: 1200, maxDrops: 25 }, difficulty: 'normal' },
  { id: 'time-limit', name: N('Time limit'), desc: N('Reach 1500 points within 60 seconds of sim time.'),
    goals: { targetScore: 1500, timeLimitTicks: 3600 }, difficulty: 'normal' },
  { id: 'high-line', name: N('High warning line'), desc: N('Hard pool, no mercy: reach tier 7 with ≤ 35 drops.'),
    goals: { requireTier: 7, maxDrops: 35 }, difficulty: 'hard' },
];

export const MODE_NAMES = { learn: N('Learn'), journey: N('Journey'), daily: N('Daily'), practice: N('Practice'), challenge: N('Challenge') };
export const DIFF_NAMES = { easy: N('Easy'), normal: N('Normal'), hard: N('Hard') };

// The game's own options (engine `settings`, synced with the account). Sound, graphics, reduced
// motion, high contrast and larger text are the runtime's Options now.
export const DEFAULT_OPTIONS = { palette: 'default', haptics: true };
export const OPTION_KEYS = Object.keys(DEFAULT_OPTIONS);
/** Every key the browser build patched into the account's settings KV (all removed after migration). */
export const BROWSER_KEYS = ['music', 'sfx', 'amb', 'mute', 'haptics', 'gfx', 'palette', 'reducedMotion', 'highContrast', 'largerText'];
/** The valid option values among `o`'s keys. */
export function pickOptions(o) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  if (typeof o.palette === 'string' && Object.prototype.hasOwnProperty.call(PALETTES, o.palette)) out.palette = o.palette;
  if (typeof o.haptics === 'boolean') out.haptics = o.haptics;
  return out;
}

/** The empty save (the browser build's defaultSave without the settings the runtime owns now). */
export function defaultSave() {
  return {
    version: SAVE_VERSION,
    settings: { tutorialDone: false },
    journey: { unlocked: 1, cleared: {} },
    daily: {},            // 'YYYY-MM-DD' -> {score, hash}
    leaderboard: [],      // {mode, score, seed, difficulty, hash, replay, date}
    resume: null,         // {snap, commands, mode, modeOpts, savedAt, pausedMs}
    achievements: {},     // key -> ISO date of the unlock
    lifetime: 0,
  };
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** A stored save (this device's or the account's), normalized; the default for anything unreadable. */
export function readSave(data) {
  const d = defaultSave();
  if (!isObj(data)) return d;
  const out = { ...d, ...JSON.parse(JSON.stringify(data)) };
  delete out.sum;
  out.version = SAVE_VERSION;
  out.settings = isObj(out.settings) ? out.settings : { tutorialDone: false };
  out.settings.tutorialDone = !!out.settings.tutorialDone;
  if (!isObj(out.journey)) out.journey = d.journey;
  out.journey.unlocked = Math.max(1, Math.min(JOURNEY_COUNT, Number(out.journey.unlocked) || 1));
  if (!isObj(out.journey.cleared)) out.journey.cleared = {};
  if (!isObj(out.daily)) out.daily = {};
  if (!Array.isArray(out.leaderboard)) out.leaderboard = [];
  if (!isObj(out.resume) || !isObj(out.resume.snap) || !isObj(out.resume.modeOpts)) out.resume = null;
  if (!isObj(out.achievements)) out.achievements = {};
  out.lifetime = Number(out.lifetime) || 0;
  return out;
}

/**
 * The browser build's cloud document (StarHermit JS SDK writeSave into the game:<slug> slot:
 * { version: 1, savedAt, save: { …save without its checksum } }) as a save, or null when the
 * text is not one. Also returns the options its settings carried (palette, haptics).
 */
export function readForeign(text) {
  let doc;
  try { doc = JSON.parse(String(text)); } catch { return null; }
  if (!isObj(doc) || !isObj(doc.save) || !isObj(doc.save.settings)) return null;
  return { save: readSave(doc.save), options: pickOptions(doc.save.settings) };
}

/** Two saves merged (src/save-merge.js: nothing either side earned is dropped), normalized. */
export function merge(remote, local) {
  return readSave(mergeSaves(readSave(remote), readSave(local)));
}
export const sameSave = (a, b) => JSON.stringify(a) === JSON.stringify(b);
