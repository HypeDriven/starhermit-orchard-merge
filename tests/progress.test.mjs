// The save model the engine client keeps (src/progress.js over src/save-merge.js):
// reading saves, the browser build's cloud document (the foreign save), the merge
// two devices' saves go through, the options carried over, the content tables.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mergeSaves } from '../src/save-merge.js';
import * as P from '../src/progress.js';

const R = createRequire(import.meta.url)('../src/rules.js');

test('mergeSaves keeps the better result of each side', () => {
  const a = { settings: { tutorialDone: true }, journey: { unlocked: 5, cleared: { 1: 100 } }, daily: { d: { score: 50 } },
    leaderboard: [{ mode: 'daily', score: 10, hash: 1, date: 'x' }], achievements: { a: '2026-01-02' }, lifetime: 10, resume: { r: 1 } };
  const b = { settings: { tutorialDone: false, mute: true }, journey: { unlocked: 2, cleared: { 1: 300, 2: 5 } }, daily: { d: { score: 20 }, e: { score: 1 } },
    leaderboard: [{ mode: 'daily', score: 10, hash: 1, date: 'x' }, { mode: 'journey', score: 99, hash: 2, date: 'y' }], achievements: { a: '2026-01-01', b: '2026-01-03' }, lifetime: 5, resume: null };
  const m = mergeSaves(a, b);
  assert.deepEqual(m.journey, { unlocked: 5, cleared: { 1: 300, 2: 5 } });
  assert.deepEqual(m.daily, { d: { score: 50 }, e: { score: 1 } });
  assert.deepEqual(m.leaderboard.map((e) => e.score), [99, 10]);
  assert.deepEqual(m.achievements, { a: '2026-01-01', b: '2026-01-03' });
  assert.equal(m.lifetime, 10);
  assert.equal(m.settings.tutorialDone, true);
  assert.equal(m.settings.mute, true);
  assert.deepEqual(m.resume, { r: 1 });
});

test('readSave normalizes anything into a usable save', () => {
  assert.deepEqual(P.readSave(null), P.defaultSave());
  assert.deepEqual(P.readSave('junk'), P.defaultSave());
  const s = P.readSave({ sum: 123, journey: { unlocked: 99 }, daily: [], resume: { mode: 'practice' }, lifetime: 'x' });
  assert.equal(s.sum, undefined);
  assert.equal(s.journey.unlocked, 40);
  assert.deepEqual(s.journey.cleared, {});
  assert.deepEqual(s.daily, {});
  assert.equal(s.resume, null, 'a resume without a snapshot is dropped');
  assert.equal(s.lifetime, 0);
  assert.equal(s.settings.tutorialDone, false);
});

test('the browser build\'s cloud document migrates (foreign save): progress, the run in progress and the options', () => {
  const game = R.newGame(42, { difficulty: 'normal' });
  R.applyCommand(game, { kind: 'drop', x: 10 });
  for (let i = 0; i < 40; i++) R.step(game);
  const old = {
    version: 1, savedAt: '2026-10-16T10:00:00.000Z',
    save: {
      version: 1,
      settings: { music: 0.5, sfx: 0.8, amb: 0.4, mute: false, haptics: false, gfx: { preset: 'auto' }, palette: 'pastel',
        reducedMotion: false, highContrast: false, largerText: false, tutorialDone: true },
      journey: { unlocked: 4, cleared: { 0: 520, 1: 700, 2: 880 } },
      daily: { '2026-10-15': { score: 1400, hash: 77 } },
      leaderboard: [{ mode: 'journey', score: 880, seed: 1, difficulty: 'easy', hash: 5, replay: { seed: 1, difficulty: 'easy', goals: null, commands: [], finalTick: 1 }, date: '2026-10-15T09:00:00.000Z' }],
      resume: { snap: R.snapshot(game), commands: [{ kind: 'drop', x: 10, tick: 0 }], mode: 'practice', modeOpts: { seed: 42, difficulty: 'normal' }, savedAt: 1, pausedMs: 0 },
      achievements: { 'first-completion': '2026-10-14T00:00:00.000Z' },
      lifetime: 3100,
    },
  };
  const f = P.readForeign(JSON.stringify(old));
  assert.ok(f);
  assert.equal(f.save.settings.tutorialDone, true);
  assert.equal(f.save.journey.unlocked, 4);
  assert.equal(f.save.daily['2026-10-15'].score, 1400);
  assert.equal(f.save.leaderboard.length, 1);
  assert.equal(f.save.lifetime, 3100);
  assert.deepEqual(f.options, { palette: 'pastel', haptics: false });
  // The run in progress restores to the very same state.
  const back = R.restore(f.save.resume.snap);
  assert.equal(R.stateHash(back), R.stateHash(game));
  // Merged with this device's (newer journey here, older elsewhere).
  const mine = P.readSave({ journey: { unlocked: 6, cleared: { 4: 1000 } }, lifetime: 200 });
  const m = P.merge(f.save, mine);
  assert.deepEqual(m.journey, { unlocked: 6, cleared: { 0: 520, 1: 700, 2: 880, 4: 1000 } });
  assert.equal(m.lifetime, 3100);
  assert.equal(m.settings.tutorialDone, true);
  assert.ok(m.resume, 'the cloud run in progress is kept when this device has none');
  assert.equal(P.sameSave(P.merge(m, m), m), true, 'merging again changes nothing');
  assert.equal(P.readForeign('not json'), null);
  assert.equal(P.readForeign(JSON.stringify({ version: 1 })), null);
});

test('pickOptions keeps only valid palette and haptics values', () => {
  assert.deepEqual(P.pickOptions({ palette: 'citrus', haptics: true, music: 1 }), { palette: 'citrus', haptics: true });
  assert.deepEqual(P.pickOptions({ palette: 'neon', haptics: 'yes' }), {});
  for (const k of P.OPTION_KEYS) assert.ok(P.BROWSER_KEYS.includes(k));
});

test('journey stages and challenges are the browser build\'s', () => {
  const s0 = P.journeyStage(0, R.hashStr), s39 = P.journeyStage(39, R.hashStr);
  assert.deepEqual(s0.goals, { targetScore: 200, requireTier: 3, maxDrops: 40 });
  assert.equal(s0.difficulty, 'easy');
  assert.equal(s0.seed, R.hashStr('journey-0'));
  assert.deepEqual(s39.goals, { targetScore: 200 + 39 * 160, requireTier: 8, maxDrops: 40 + Math.floor(39 * 1.5) });
  assert.equal(s39.difficulty, 'hard');
  assert.deepEqual(P.CHALLENGES.map((c) => c.id), ['move-limit', 'time-limit', 'high-line']);
  for (const pal of Object.values(P.PALETTES)) assert.equal(pal.length, 11);
  assert.equal(Object.keys(P.ACHIEVEMENTS).length, 5);
});
