'use strict';

const test = require('node:test');
const assert = require('node:assert');
const R = require('../src/rules.js');

test('newGame is deterministic for a seed', () => {
  const a = R.newGame(1234);
  const b = R.newGame(1234);
  assert.strictEqual(a.currentTier, b.currentTier);
  assert.strictEqual(a.nextTier, b.nextTier);
  assert.strictEqual(R.stateHash(a), R.stateHash(b));
});

test('drop command adds a fruit and locks input during cooldown', () => {
  const s = R.newGame(7);
  assert.ok(R.legalActions(s).drop);
  assert.ok(R.applyCommand(s, { kind: 'drop', x: 10 }));
  assert.strictEqual(s.fruits.length, 1);
  assert.strictEqual(s.drops, 1);
  assert.strictEqual(R.legalActions(s).drop, false);
  assert.ok(!R.applyCommand(s, { kind: 'drop', x: 10 })); // rejected: cooldown
  assert.strictEqual(s.invalidActions, 1);
});

test('equal tiers merge and score by tier', () => {
  const s = R.newGame(42);
  // force same tier twice by reseeding expectations: drop at same x
  const t0 = s.currentTier;
  R.applyCommand(s, { kind: 'drop', x: 10 });
  R.settle(s);
  // force current tier back to t0 for a deterministic merge test
  s.currentTier = t0;
  R.applyCommand(s, { kind: 'drop', x: 10 });
  R.settle(s);
  assert.strictEqual(s.merges >= 1, true);
  assert.strictEqual(s.mergeScore, R.mergePoints(t0 + 1));
  assert.ok(s.maxTier >= t0 + 1);
  assert.strictEqual(s.fruits.length, 1);
  assert.strictEqual(s.fruits[0].tier, t0 + 1);
});

test('replay: same seed + commands produce identical hashes', () => {
  const cmds = [{ kind: 'drop', x: 5 }, { kind: 'drop', x: 15 }, { kind: 'drop', x: 10 },
    { kind: 'drop', x: 3.5 }, { kind: 'drop', x: 16.25 }, { kind: 'drop', x: 8 }];
  function run() {
    const s = R.newGame(999, { difficulty: 'normal' });
    const hashes = [];
    for (const c of cmds) {
      R.applyCommand(s, c);
      R.settle(s);
      hashes.push(R.stateHash(s));
    }
    return { s, hashes };
  }
  const a = run();
  const b = run();
  assert.deepStrictEqual(a.hashes, b.hashes);
  assert.strictEqual(R.stateHash(a.s), R.stateHash(b.s));
  assert.strictEqual(a.s.score, b.s.score);
});

test('snapshot/restore round-trips and continues deterministically', () => {
  const s = R.newGame(555);
  R.applyCommand(s, { kind: 'drop', x: 6 });
  R.settle(s);
  const snap = R.snapshot(s);
  const h1 = R.stateHash(s);
  const r = R.restore(snap);
  assert.strictEqual(R.stateHash(r), h1);
  // continue both: same future
  R.applyCommand(s, { kind: 'drop', x: 12 });
  R.applyCommand(r, { kind: 'drop', x: 12 });
  R.settle(s); R.settle(r);
  assert.strictEqual(R.stateHash(s), R.stateHash(r));
  assert.strictEqual(s.currentTier, r.currentTier);
});

test('undo via snapshot restores score and fruit list', () => {
  const s = R.newGame(31);
  const before = R.snapshot(s);
  R.applyCommand(s, { kind: 'drop', x: 10 });
  R.settle(s);
  const r = R.restore(before);
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.fruits.length, 0);
  assert.strictEqual(r.drops, 0);
});

test('malformed and unknown commands are rejected idempotently', () => {
  const s = R.newGame(1);
  assert.ok(!R.applyCommand(s, null));
  assert.ok(!R.applyCommand(s, { kind: 'nope' }));
  assert.ok(!R.applyCommand(s, { kind: 'drop', x: NaN }));
  assert.strictEqual(s.invalidActions, 3);
  assert.strictEqual(s.fruits.length, 0);
});

test('fuzz: random commands never hang, NaN, or loop unbounded', () => {
  for (const seed of [1, 2, 3, 77, 123456]) {
    const s = R.newGame(seed, { difficulty: 'hard' });
    const rng = R.mulberry32(seed);
    for (let i = 0; i < 200 && s.status === 'active'; i++) {
      const x = (rng() - 0.5) * 100;
      R.applyCommand(s, { kind: 'drop', x });
      const n = R.settle(s, 3600);
      assert.ok(n <= 3600, 'settle bounded');
      for (const f of s.fruits) {
        assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y), 'finite positions');
        assert.ok(f.x >= 0 && f.x <= R.WORLD_W && f.y >= 0 && f.y <= R.WORLD_H + 6, 'in bounds');
      }
    }
  }
});

test('overflow ends the game with a terminal reason', () => {
  const s = R.newGame(5, { difficulty: 'hard' });
  // pile drops into one column until the stack crosses the warning line
  let guard = 0;
  while (s.status === 'active' && guard++ < 500) {
    R.applyCommand(s, { kind: 'drop', x: 10 });
    R.settle(s);
  }
  assert.strictEqual(s.status, 'over');
  assert.strictEqual(s.terminalReason, 'overflow');
  const bd = R.scoreBreakdown(s);
  assert.strictEqual(bd.total, s.score);
  assert.ok(bd.merges >= 0 && bd.drops > 0);
});

test('goal-complete terminal state for maxDrops goals', () => {
  const s = R.newGame(60, { goals: { targetScore: 1, maxDrops: 60 } });
  let guard = 0;
  while (s.status === 'active' && guard++ < 200) {
    R.applyCommand(s, { kind: 'drop', x: 4 + (guard % 12) });
    R.settle(s);
  }
  assert.strictEqual(s.status, 'over');
  assert.ok(['goal-complete', 'move-limit', 'overflow'].includes(s.terminalReason));
});

test('hint returns a legal quantized column', () => {
  const s = R.newGame(11);
  R.applyCommand(s, { kind: 'drop', x: 10 });
  R.settle(s);
  const x = R.hint(s);
  const r = R.TIER_R[s.currentTier];
  assert.ok(x >= r && x <= R.WORLD_W - r);
  assert.ok(Math.abs(x / R.X_QUANTUM - Math.round(x / R.X_QUANTUM)) < 1e-6);
});

test('resign ends the run', () => {
  const s = R.newGame(3);
  assert.ok(R.applyCommand(s, { kind: 'resign' }));
  assert.strictEqual(s.terminalReason, 'resigned');
  assert.ok(!R.applyCommand(s, { kind: 'drop', x: 10 }));
});

test('journey stage content validator: all 40 stages legal and bounded', () => {
  for (let i = 1; i <= 40; i++) {
    const stage = {
      id: 'journey-' + i,
      seed: R.hashStr('journey-stage-' + i),
      goals: {
        targetScore: 150 + i * 120,
        requireTier: Math.min(3 + Math.floor(i / 8), 8),
        maxDrops: 30 + Math.floor(i * 1.5),
      },
    };
    assert.ok(stage.seed > 0);
    assert.ok(stage.goals.maxDrops > 0 && stage.goals.maxDrops <= 120, 'bounded duration');
    assert.ok(stage.goals.requireTier <= R.TIER_MAX - 1, 'reachable tier goal');
    // legality smoke: a random policy run must terminate or stay finite
    const s = R.newGame(stage.seed, { goals: stage.goals });
    const rng = R.mulberry32(stage.seed);
    let guard = 0;
    while (s.status === 'active' && guard++ < stage.goals.maxDrops + 5) {
      R.applyCommand(s, { kind: 'drop', x: rng() * R.WORLD_W });
      R.settle(s);
    }
    assert.ok(guard <= stage.goals.maxDrops + 5, 'no soft lock');
    assert.notStrictEqual(s.status, 'active', 'stage terminates under random play');
  }
});

test('daily seed is stable per date string', () => {
  const a = R.hashStr('orchard-daily-2026-08-30');
  const b = R.hashStr('orchard-daily-2026-08-30');
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, R.hashStr('orchard-daily-2026-08-31'));
});
