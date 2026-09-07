'use strict';

/*
 * Orchard Merge — deterministic rules engine.
 * Pure state transitions, no rendering. All randomness flows from seeded
 * streams so identical (version, seed, command log) replays produce
 * identical state hashes. Works in Node (server/tests) and the browser.
 */

const RULES_VERSION = 1;
const TIER_MIN = 1;
const TIER_MAX = 10;
const STEP_MS = 1000 / 60;          // fixed simulation step
const WORLD_W = 20;                  // container inner width (sim units)
const WORLD_H = 30;                  // container height
const WARN_Y = 22.5;                 // warning line height
const GRACE_TICKS = 150;             // 2.5s above the line before game over
const GRAVITY = -55;
const RESTITUTION = 0.08;
const FRICTION = 0.985;
const AIR_DAMP = 0.999;
const SETTLE_SPEED = 2.5;            // below this a fruit counts as settled
const DROP_COOLDOWN_TICKS = 30;      // input lock after a drop
const X_QUANTUM = 0.05;              // authoritative input quantization

// radius per tier (deterministic table, not a formula, to keep it inspectable)
const TIER_R = [0, 0.95, 1.2, 1.5, 1.85, 2.25, 2.7, 3.2, 3.8, 4.5, 5.3];
// score awarded when a merge produces tier t (t = 2..TIER_MAX)
function mergePoints(t) { return t * t * 5; }
// spawnable drop tiers per difficulty band
const DROP_POOLS = {
  easy: [1, 1, 2, 2, 3],
  normal: [1, 2, 2, 3, 3, 4],
  hard: [1, 2, 3, 3, 4, 4, 5],
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

function quantizeX(x) {
  const r = TIER_R[1]; // clamp against smallest tier; spawn clamps per tier anyway
  let q = Math.round(x / X_QUANTUM) * X_QUANTUM;
  q = Math.max(r, Math.min(WORLD_W - r, q));
  return Math.round(q * 1000) / 1000;
}

// ---- state ------------------------------------------------------------------

function newGame(seed, opts) {
  opts = opts || {};
  const difficulty = DROP_POOLS[opts.difficulty] ? opts.difficulty : 'normal';
  const rng = mulberry32(seed >>> 0);
  const s = {
    version: RULES_VERSION,
    seed: seed >>> 0,
    difficulty,
    tick: 0,
    status: 'active',            // active | over
    terminalReason: null,        // overflow | goal-complete | move-limit | resigned
    fruits: [],                  // {id,x,y,vx,vy,tier,age}
    nextId: 1,
    currentTier: 0,
    nextTier: 0,
    score: 0,
    mergeScore: 0,
    merges: 0,
    maxTier: 0,
    drops: 0,
    invalidActions: 0,
    cooldown: 0,                 // ticks until next drop allowed
    aboveLineTicks: 0,
    goals: opts.goals || null,   // {targetScore?, requireTier?, maxDrops?, timeLimitTicks?}
    events: [],                  // drained by the session layer each step
    _rngState: null,
  };
  // serialize rng by re-seeding through a counter stream
  s._rng = rng;
  s._rngCount = 0;
  currentTierDraw(s);
  currentTierDraw(s); // current + next
  return s;
}

function drawFromPool(s) {
  const pool = DROP_POOLS[s.difficulty];
  const r = s._rng();
  s._rngCount++;
  return pool[Math.floor(r * pool.length) % pool.length];
}

function currentTierDraw(s) {
  s.currentTier = s.nextTier || drawFromPool(s);
  s.nextTier = drawFromPool(s);
}

// ---- legal actions ------------------------------------------------------------

function legalActions(s) {
  const over = s.status !== 'active';
  return {
    drop: !over && s.cooldown <= 0,
    undo: !over,                 // session layer decides if a snapshot exists
    hint: !over && s.fruits.length > 0,
    resign: !over,
  };
}

// Best drop column: prefers landing next to a same-tier fruit.
function hint(s) {
  let bestX = WORLD_W / 2;
  let bestScore = -Infinity;
  for (const f of s.fruits) {
    const r = TIER_R[s.currentTier] + TIER_R[f.tier];
    for (const x of [f.x - r, f.x + r]) {
      if (x < TIER_R[s.currentTier] || x > WORLD_W - TIER_R[s.currentTier]) continue;
      let v = f.tier === s.currentTier ? 100 + f.tier * 10 : f.tier * 2;
      v -= Math.abs(x - WORLD_W / 2) * 0.01;
      if (v > bestScore) { bestScore = v; bestX = x; }
    }
  }
  return quantizeX(bestX);
}

// ---- commands -----------------------------------------------------------------

// Returns true if accepted; rejects push an 'invalid' event with a reason.
function applyCommand(s, cmd) {
  if (!cmd || typeof cmd !== 'object') return invalid(s, 'malformed-command');
  switch (cmd.kind) {
    case 'drop': {
      if (s.status !== 'active') return invalid(s, 'game-over');
      if (s.cooldown > 0) return invalid(s, 'cooldown');
      if (typeof cmd.x !== 'number' || !isFinite(cmd.x)) return invalid(s, 'bad-x');
      const tier = s.currentTier;
      const r = TIER_R[tier];
      let x = quantizeX(cmd.x);
      x = Math.max(r, Math.min(WORLD_W - r, x));
      s.fruits.push({ id: s.nextId++, x, y: WORLD_H - r - 0.5, vx: 0, vy: 0, tier, age: 0 });
      s.drops++;
      s.cooldown = DROP_COOLDOWN_TICKS;
      currentTierDraw(s);
      s.events.push({ kind: 'drop', tier, x });
      return true;
    }
    case 'resign': {
      if (s.status !== 'active') return invalid(s, 'game-over');
      endGame(s, 'resigned');
      return true;
    }
    default:
      return invalid(s, 'unknown-command');
  }
}

function invalid(s, reason) {
  s.invalidActions++;
  s.events.push({ kind: 'invalid', reason });
  return false;
}

function endGame(s, reason) {
  s.status = 'over';
  s.terminalReason = reason;
  s.events.push({ kind: 'gameover', reason, score: s.score });
}

// ---- simulation ----------------------------------------------------------------

function step(s) {
  if (s.status !== 'active') return;
  s.tick++;
  if (s.cooldown > 0) s.cooldown--;

  const fr = s.fruits;
  for (const f of fr) {
    f.age++;
    f.vy += GRAVITY * (STEP_MS / 1000);
    f.vx *= AIR_DAMP; f.vy *= AIR_DAMP;
    f.x += f.vx * (STEP_MS / 1000) * 60 * 0.016;
    f.y += f.vy * (STEP_MS / 1000) * 60 * 0.016;
  }

  // walls & floor
  for (const f of fr) {
    const r = TIER_R[f.tier];
    if (f.x < r) { f.x = r; f.vx = -f.vx * RESTITUTION; }
    else if (f.x > WORLD_W - r) { f.x = WORLD_W - r; f.vx = -f.vx * RESTITUTION; }
    if (f.y < r) { f.y = r; f.vy = -f.vy * RESTITUTION; f.vx *= FRICTION; }
  }

  // circle collisions, deterministic order (by id)
  const order = fr.slice().sort((a, b) => a.id - b.id);
  const mergePairs = [];
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      const a = order[i], b = order[j];
      if (a._dead || b._dead) continue;
      const ra = TIER_R[a.tier], rb = TIER_R[b.tier];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist2 = dx * dx + dy * dy;
      const minD = ra + rb;
      if (dist2 >= minD * minD || dist2 === 0) continue;
      const dist = Math.sqrt(dist2);
      if (a.tier === b.tier && a.tier < TIER_MAX && a.age > 10 && b.age > 10
          && dist < minD * 0.92) {
        mergePairs.push([a, b]);
        a._dead = b._dead = true;
        continue;
      }
      // positional correction + impulse
      const nx = dx / dist, ny = dy / dist;
      const overlap = minD - dist;
      const ma = rb / minD, mb = ra / minD; // heavier tier moves less
      a.x -= nx * overlap * ma; a.y -= ny * overlap * ma;
      b.x += nx * overlap * mb; b.y += ny * overlap * mb;
      const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
      const rel = rvx * nx + rvy * ny;
      if (rel < 0) {
        const imp = -(1 + RESTITUTION) * rel / 2;
        a.vx -= imp * nx; a.vy -= imp * ny;
        b.vx += imp * nx; b.vy += imp * ny;
      }
    }
  }

  // final containment pass: pair corrections may push fruit back through a wall
  for (const f of s.fruits) {
    const r = TIER_R[f.tier];
    if (f.x < r) f.x = r; else if (f.x > WORLD_W - r) f.x = WORLD_W - r;
    if (f.y < r) { f.y = r; if (f.vy < 0) f.vy = 0; }
  }

  // resolve merges (in id order for determinism)
  if (mergePairs.length) {
    for (const [a, b] of mergePairs) {
      const nt = a.tier + 1;
      const nx = (a.x + b.x) / 2, ny = (a.y + b.y) / 2;
      const pts = mergePoints(nt);
      s.score += pts;
      s.mergeScore += pts;
      s.merges++;
      if (nt > s.maxTier) s.maxTier = nt;
      const nf = { id: s.nextId++, x: nx, y: ny, vx: (a.vx + b.vx) / 2, vy: (a.vy + b.vy) / 2, tier: nt, age: 0 };
      s.fruits = s.fruits.filter(f => f !== a && f !== b);
      // clamp spawn inside the box
      const r = TIER_R[nt];
      nf.x = Math.max(r, Math.min(WORLD_W - r, nf.x));
      nf.y = Math.max(r, Math.min(WORLD_H - r, nf.y));
      s.fruits.push(nf);
      s.events.push({ kind: 'merge', tier: nt, x: nf.x, y: nf.y, points: pts });
    }
    for (const f of s.fruits) delete f._dead;
  }

  // warning line / overflow
  let above = false;
  for (const f of s.fruits) {
    if (f.y - TIER_R[f.tier] > WORLD_H) { // fully over the rim: spilled
      endGame(s, 'overflow');
      return;
    }
    if (above) continue; // keep scanning for spills, the warning state is settled
    const speed = Math.abs(f.vx) + Math.abs(f.vy);
    if (f.y + TIER_R[f.tier] * 0.5 > WARN_Y && speed < SETTLE_SPEED && f.age > 30) above = true;
  }
  if (above) {
    s.aboveLineTicks++;
    if (s.aboveLineTicks === 1) s.events.push({ kind: 'warn' });
    if (s.aboveLineTicks >= GRACE_TICKS) { endGame(s, 'overflow'); return; }
  } else if (s.aboveLineTicks > 0) {
    s.aboveLineTicks = 0;
    s.events.push({ kind: 'warn-clear' });
  }

  // goals
  const g = s.goals;
  if (g) {
    if (g.maxDrops && s.drops >= g.maxDrops) {
      const ok = (!g.targetScore || s.score >= g.targetScore) &&
                 (!g.requireTier || s.maxTier >= g.requireTier);
      endGame(s, ok ? 'goal-complete' : 'move-limit');
      return;
    }
    if (g.timeLimitTicks && s.tick >= g.timeLimitTicks) {
      const ok = (!g.targetScore || s.score >= g.targetScore);
      endGame(s, ok ? 'goal-complete' : 'move-limit');
      return;
    }
    if (!g.maxDrops && !g.timeLimitTicks && g.targetScore && s.score >= g.targetScore
        && (!g.requireTier || s.maxTier >= g.requireTier)) {
      endGame(s, 'goal-complete');
    }
  }
}

// Run until all fruit settle or the game ends (skip/fast-forward support).
function settle(s, maxTicks) {
  maxTicks = maxTicks || 3600;
  let n = 0;
  while (s.status === 'active' && n < maxTicks) {
    step(s);
    n++;
    let moving = false;
    for (const f of s.fruits) {
      if (Math.abs(f.vx) + Math.abs(f.vy) > SETTLE_SPEED) { moving = true; break; }
    }
    if (!moving && s.cooldown <= 0 && s.aboveLineTicks === 0) break;
  }
  return n;
}

// ---- score breakdown ----------------------------------------------------------

function scoreBreakdown(s) {
  const maxTierBonus = s.maxTier >= 2 ? mergePoints(s.maxTier) * 2 : 0;
  const efficiency = s.drops > 0 ? Math.round(s.mergeScore / s.drops) : 0;
  return {
    mergeScore: s.mergeScore,
    maxTierBonus,
    efficiencyPerDrop: efficiency,
    drops: s.drops,
    merges: s.merges,
    maxTier: s.maxTier,
    invalidActions: s.invalidActions,
    ticks: s.tick,
    total: s.score,
  };
}

// ---- serialization --------------------------------------------------------------

function snapshot(s) {
  return {
    version: s.version, seed: s.seed, difficulty: s.difficulty, tick: s.tick,
    status: s.status, terminalReason: s.terminalReason,
    fruits: s.fruits.map(f => ({ id: f.id, x: f.x, y: f.y, vx: f.vx, vy: f.vy, tier: f.tier, age: f.age })),
    nextId: s.nextId, currentTier: s.currentTier, nextTier: s.nextTier,
    score: s.score, mergeScore: s.mergeScore, merges: s.merges, maxTier: s.maxTier,
    drops: s.drops, invalidActions: s.invalidActions, cooldown: s.cooldown,
    aboveLineTicks: s.aboveLineTicks, goals: s.goals, _rngCount: s._rngCount,
  };
}

function restore(snap) {
  const s = newGame(snap.seed >>> 0, { difficulty: snap.difficulty, goals: snap.goals });
  s.tick = snap.tick; s.status = snap.status; s.terminalReason = snap.terminalReason;
  s.fruits = snap.fruits.map(f => ({ ...f }));
  s.nextId = snap.nextId; s.currentTier = snap.currentTier; s.nextTier = snap.nextTier;
  s.score = snap.score; s.mergeScore = snap.mergeScore; s.merges = snap.merges;
  s.maxTier = snap.maxTier; s.drops = snap.drops;
  s.invalidActions = snap.invalidActions; s.cooldown = snap.cooldown;
  s.aboveLineTicks = snap.aboveLineTicks; s.events = [];
  // fast-forward the rng stream to the recorded count
  s._rng = mulberry32(snap.seed >>> 0);
  for (let i = 0; i < snap._rngCount; i++) s._rng();
  s._rngCount = snap._rngCount;
  return s;
}

function stateHash(s) {
  const parts = [s.version, s.seed, s.tick, s.status, s.score, s.merges, s.drops,
    s.currentTier, s.nextTier, s.aboveLineTicks, s.invalidActions];
  for (const f of s.fruits) {
    parts.push(f.id, f.tier, Math.round(f.x * 1000), Math.round(f.y * 1000),
      Math.round(f.vx * 1000), Math.round(f.vy * 1000));
  }
  return hashStr(parts.join('|'));
}

const api = {
  RULES_VERSION, TIER_MIN, TIER_MAX, STEP_MS, WORLD_W, WORLD_H, WARN_Y,
  GRACE_TICKS, TIER_R, DROP_POOLS, X_QUANTUM,
  mulberry32, hashStr, quantizeX, mergePoints,
  newGame, legalActions, hint, applyCommand, step, settle,
  scoreBreakdown, snapshot, restore, stateHash,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof globalThis !== 'undefined') globalThis.OrchardRules = api;
