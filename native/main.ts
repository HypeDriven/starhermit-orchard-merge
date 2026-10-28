// Orchard Merge on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The deterministic rules (src/rules.js), the
// content and save model (src/progress.js, src/save-merge.js) and the string
// tables (src/i18n.js, src/locales) are the browser build's pure modules,
// shared with the Node tests and the dev server; this module is what its
// src/main.js did around them: the run (modes, the countdown, the 60 Hz
// fixed-step simulation, drops, practice undo, hints, fast-forward settling,
// the tutorial's steps, the warning line, the results, achievements, journey
// and daily progress, the local best runs with their replays, posting ranked
// runs to the high-score board), the run in progress that survives leaving,
// the screens' navigation (screens.ts draws them) and input: the aim keys and
// pad, the pointer or finger on the crate (drag to aim, release to drop), and
// every button.
import "./i18n.ts";
import {
  clipboard, frame, onFixedUpdate, onPreferencesChange, onQuit, onRender, onResume, onStart, onSuspend, onUpdate, preferences,
} from "starhermit:engine";
import { isDown, onAction, onPointerButton, onPointerMove, onTouch, vibrate } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded, requestSignIn } from "starhermit:platform";
import { R, type Goals, type State } from "./rules.ts";
import * as P from "../src/progress.js";
import * as audio from "./audio.ts";
import { account, N, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens } from "./screens.ts";
import { applyContrast, initStyles } from "./style.ts";

const { WORLD_W, TIER_R } = R;
type Text = () => string;
export type Screen = "title" | "setup" | "pause" | "results" | "settings" | "help" | null;
export type Mode = "learn" | "journey" | "daily" | "practice" | "challenge";
export type SetupMode = Mode | "scores";
export type Phase = "title" | "setup" | "countdown" | "active" | "paused" | "resolving" | "results";
export interface ModeOpts { seed: number; difficulty: string; goals?: Goals | null; stageI?: number; ranked?: boolean; desc?: string }

export const app = {
  /** The screen over the stall (null: the HUD of a run). */
  screen: "title" as Screen,
  /** Frame the screen opened on (the press that opened it must not also act on it). */
  openedFrame: 0,
  focusNext: null as string | null,
  setupMode: "practice" as SetupMode,
  practiceDiff: 1,
  /** The Score chase's global board rows (null: loading, none or guest). */
  boardRows: null as platform.BoardRow[] | null,
  toast: null as null | { text: Text; until: number },
  /** The countdown's text and the fixed steps until it changes. */
  countdown: null as null | { n: number; ticks: number },
  warn: false,
  /** The results: headline reason, breakdown and the leaderboard line (undefined: none). */
  result: null as null | { reason: string; bd: ReturnType<typeof R.scoreBreakdown>; hash: number },
  lbResult: undefined as undefined | null | { posted: boolean; rank: number | null },
  /** A journey win offers the next stage. */
  pendingNext: null as number | null,
};
export const options = platform.options;
const now = (): number => frame().time;
export const save = (): platform.Save => platform.save;

// ------------------------------------------------------------------ text helpers
export const tierName = (tier: number): string => (P.TIER_NAMES[tier] ? T(P.TIER_NAMES[tier]!) : "—");
export function announce(text: string): void { if (text) ui.announce(text.slice(0, 480)); }
export function toast(text: Text): void { app.toast = { text, until: now() + 3.2 }; announce(text()); }
export const motionOK = (): boolean => !preferences().reducedMotion;

// ------------------------------------------------------------------ screens
export function showScreen(s: Screen, focus: string | null = null): void {
  app.screen = s;
  app.openedFrame = frame().frame;
  app.focusNext = s ? focus ?? "first" : null;
  ui.setFocus(null);
}
export const fresh = (n = 1): boolean => frame().frame - app.openedFrame <= n;

// ------------------------------------------------------------------ the run
export const run = {
  state: null as State | null,
  mode: "practice" as Mode,
  modeOpts: { seed: 0, difficulty: "normal" } as ModeOpts,
  phase: "title" as Phase,
  commands: [] as { kind: "drop"; x: number; tick: number }[],
  undoStack: [] as ReturnType<typeof R.snapshot>[],
  aimX: WORLD_W / 2,
  tutorialStep: -1,
  ranked: false,
  pausedMs: 0,
  pauseAt: 0,
  newAchievements: [] as string[],
  /** Fixed steps until the results show (onGameOver's 900 ms). */
  resolveIn: 0,
  /** Fast-forward settling in progress (skipSettle, spread over frames). */
  settling: 0,
};

function unlock(key: string): void {
  const s = save();
  if (!(key in P.ACHIEVEMENTS) || s.achievements[key]) return;
  s.achievements[key] = new Date(platform.nowMs()).toISOString();
  announce(T("Achievement unlocked: {name}.", { name: T((P.ACHIEVEMENTS as Record<string, string>)[key]!) }));
  run.newAchievements.push(key);
}

export function setAim(x: number): void {
  run.aimX = R.quantizeX(Math.max(TIER_R[1]!, Math.min(WORLD_W - TIER_R[1]!, x)));
}

export function newRun(mode: Mode, modeOpts: ModeOpts): void {
  run.mode = mode;
  run.modeOpts = modeOpts;
  run.state = R.newGame(modeOpts.seed, { difficulty: modeOpts.difficulty, goals: modeOpts.goals || null });
  run.commands = [];
  run.undoStack = [];
  setAim(WORLD_W / 2);
  run.ranked = !!modeOpts.ranked;
  run.pausedMs = 0;
  run.tutorialStep = mode === "learn" ? 0 : -1;
  run.newAchievements = [];
  run.settling = 0;
  run.phase = "countdown";
  app.warn = false;
  app.result = null;
  render.clearHint();
  save().resume = null;
  platform.persist();
  showScreen(null);
  app.countdown = { n: 3, ticks: 42 };
  audio.sfx.countdown(3);
}

function serializeResume(): void {
  const st = run.state;
  if (!st || st.status !== "active") return;
  save().resume = { snap: R.snapshot(st), commands: run.commands, mode: run.mode, modeOpts: run.modeOpts, savedAt: platform.nowMs(), pausedMs: run.pausedMs } as never;
  platform.persist();
}

export function resumeRun(): void {
  const r = save().resume as null | { snap: ReturnType<typeof R.snapshot>; commands: typeof run.commands; mode: Mode; modeOpts: ModeOpts; savedAt: number; pausedMs?: number };
  if (!r) return;
  run.mode = r.mode;
  run.modeOpts = r.modeOpts;
  run.commands = r.commands || [];
  run.undoStack = [];
  run.state = R.restore(r.snap);
  run.ranked = !!r.modeOpts.ranked;
  run.pausedMs = r.pausedMs || 0;
  setAim(WORLD_W / 2);
  run.tutorialStep = run.mode === "learn" ? Math.min(run.commands.length > 0 ? 1 : 0, 2) : -1;
  run.newAchievements = [];
  run.settling = 0;
  run.phase = "active";
  app.warn = run.state.aboveLineTicks > 0;
  app.countdown = null;
  app.result = null;
  showScreen(null);
  const mins = Math.floor(Math.max(0, platform.nowMs() - r.savedAt) / 60000);
  announce(mins === 1 ? T("Resumed. You were away 1 minute.") : T("Resumed. You were away {n} minutes.", { n: mins }));
}

export function canDrop(): boolean { return run.phase === "active" && !!run.state && R.legalActions(run.state).drop; }

export function tryDrop(x: number): void {
  if (run.phase !== "active" || !run.state) return;
  if (!R.legalActions(run.state).drop) { audio.sfx.invalid(); return; }
  const qx = R.quantizeX(x);
  const before = run.mode === "practice" ? R.snapshot(run.state) : null;
  const ok = R.applyCommand(run.state, { kind: "drop", x: qx });
  if (ok) {
    // only snapshot accepted drops, or undo would pop a command it does not own
    if (before) {
      run.undoStack.push(before);
      if (run.undoStack.length > 20) run.undoStack.shift();
    }
    run.commands.push({ kind: "drop", x: qx, tick: run.state.tick });
    audio.sfx.drop();
    if (run.mode === "learn" && run.tutorialStep === 0) run.tutorialStep = 1;
    serializeResume();
  }
  drainEvents();
}

export function canUndo(): boolean { return run.mode === "practice" && run.phase === "active" && run.undoStack.length > 0; }
export function undo(): void {
  if (!canUndo()) { audio.sfx.invalid(); return; }
  run.state = R.restore(run.undoStack.pop()!);
  run.commands.pop();
  run.settling = 0;
  app.warn = run.state.aboveLineTicks > 0;
  announce(T("Undid last drop."));
  serializeResume();
}

/** skipSettle: run the simulation until all fruit settle (rules.settle's loop, a slice of steps per frame). */
export function skipSettle(): void {
  if (!run.state || run.phase !== "active") return;
  run.settling = 3600;
}
const SETTLE_SPEED = 2.5;
function settled(s: State): boolean {
  for (const f of s.fruits) if (Math.abs(f.vx) + Math.abs(f.vy) > SETTLE_SPEED) return false;
  return s.cooldown <= 0 && s.aboveLineTicks === 0;
}

export function showHint(): void {
  if (!run.state || !R.legalActions(run.state).hint) { audio.sfx.invalid(); return; }
  const x = R.hint(run.state);
  render.showHint(x);
  announce(T("Hint: drop near position {x}.", { x: x.toFixed(1) }));
}

/** events → fx, speech, mode logic */
function drainEvents(): void {
  const s = run.state;
  if (!s || !s.events.length) return;
  for (const ev of s.events) {
    if (ev.kind === "merge") {
      render.merged(ev.x!, ev.y!, ev.tier!);
      audio.sfx.merge(ev.tier!);
      haptic(30);
      announce(T("Merged into {fruit}, plus {points} points. Score {score}.", { fruit: tierName(ev.tier!), points: ev.points!, score: s.score }));
      if (ev.tier! >= 8) unlock("merge-master");
      if (run.mode === "learn" && run.tutorialStep === 1) {
        run.tutorialStep = 2;
        save().settings.tutorialDone = true;
        platform.persist();
      }
    } else if (ev.kind === "warn") {
      audio.sfx.warn();
      app.warn = true;
      announce(T("Warning: fruit is above the line!"));
    } else if (ev.kind === "warn-clear") {
      app.warn = false;
    } else if (ev.kind === "invalid") {
      audio.sfx.invalid();
      announce(T("Invalid action: {reason}.", { reason: ev.reason! }));
    } else if (ev.kind === "gameover") {
      onGameOver(ev.reason!);
    }
  }
  s.events.length = 0;
}
function haptic(ms: number): void {
  if (!options.haptics) return;
  try { vibrate(ms); } catch { /* unsupported */ }
}

function onGameOver(reason: string): void {
  const st = run.state!;
  run.phase = "resolving";
  run.settling = 0;
  app.warn = false;
  const win = reason === "goal-complete";
  audio.sfx.fanfare(win);
  haptic(win ? 140 : 120);
  const bd = R.scoreBreakdown(st);
  const hash = R.stateHash(st);
  const s = save();
  s.resume = null;
  app.pendingNext = null;
  // mode-specific bookkeeping
  if (run.mode === "journey" && win) {
    const i = run.modeOpts.stageI!;
    s.journey.cleared[i] = Math.max(s.journey.cleared[i] || 0, bd.total);
    s.journey.unlocked = Math.max(s.journey.unlocked, Math.min(i + 2, P.JOURNEY_COUNT));
    app.pendingNext = i + 1 < P.JOURNEY_COUNT ? i + 1 : null;
    if (i === P.JOURNEY_COUNT - 1) unlock("journey-complete");
  }
  if (run.mode === "daily") {
    const d = platform.utcDate();
    const prev = s.daily[d]?.score || 0;
    if (bd.total > prev) s.daily[d] = { score: bd.total, hash };
    if (Object.keys(s.daily).length >= 3) unlock("daily-streak-3");
  }
  s.lifetime += bd.total;
  unlock("first-completion");
  if (s.lifetime >= 25000) unlock("orchard-keeper");
  if (run.ranked) {
    const entry = {
      mode: run.mode, score: bd.total, seed: st.seed, difficulty: st.difficulty, hash,
      replay: { seed: st.seed, difficulty: st.difficulty, goals: st.goals || null, commands: run.commands, finalTick: st.tick },
      date: new Date(platform.nowMs()).toISOString(),
    };
    const lb = s.leaderboard;
    lb.push(entry);
    lb.sort((a, b) => b.score - a.score);
    s.leaderboard = lb.slice(0, 50);
  }
  platform.persist();
  app.result = { reason, bd, hash };
  run.resolveIn = 54;
}

function showResults(): void {
  const r = app.result;
  if (!r) return;
  run.phase = "results";
  app.lbResult = undefined;
  if (run.ranked && platform.signedIn()) {
    // Signed in, ranked runs post their total to the high-score board (score-script.js).
    app.lbResult = null;
    const mine = run.state;
    void platform.postLeaderboard(r.bd.total).then((x) => { if (run.state === mine) app.lbResult = x; });
  }
  showScreen("results", "btn-retry");
  announce(T("{headline} Final score {score}.", { headline: resultsHeadline(), score: r.bd.total }));
}
export function resultsHeadline(): string {
  const heads: Record<string, string> = {
    overflow: N("Crate overflowed!"), "goal-complete": N("Goal complete! 🎉"), "move-limit": N("Out of moves!"), resigned: N("Run resigned"),
  };
  return T(heads[app.result?.reason ?? ""] ?? N("Run over"));
}
export function lbLine(): string | null {
  const r = app.lbResult;
  if (r === undefined) return null;
  return !r ? account().lbPosting : !r.posted ? account().lbNotPosted : r.rank ? account().lbRank.replace("{rank}", String(r.rank)) : account().lbPosted;
}

export function objectiveText(): string {
  const st = run.state;
  if (run.mode === "learn") {
    const steps = [
      N("Step 1/3: drop a fruit (aim, then Drop / Space)."),
      N("Step 2/3: make a merge — drop a matching tier onto its twin."),
      N("Step 3/3: keep fruit below the glowing warning line. Free play!"),
    ];
    return T(steps[Math.min(Math.max(0, run.tutorialStep), 2)]!);
  }
  if (run.mode === "journey") {
    const g = run.modeOpts.goals!;
    return T("Stage {n}: score {score}, reach {fruit}, within {drops} drops.", { n: run.modeOpts.stageI! + 1, score: g.targetScore!, fruit: tierName(g.requireTier!), drops: g.maxDrops! });
  }
  if (run.mode === "daily") return T("Daily {date} — one ranked run.", { date: platform.utcDate() });
  if (run.mode === "challenge") return T(run.modeOpts.desc ?? "");
  void st;
  return T("Practice — relaxed play, undo enabled, not ranked.");
}

// ------------------------------------------------------------------ navigation
export function journeyStage(i: number): ReturnType<typeof P.journeyStage> { return P.journeyStage(i, R.hashStr); }
export function startStage(i: number): void {
  const st = journeyStage(i);
  newRun("journey", { seed: st.seed, difficulty: st.difficulty, goals: st.goals, stageI: i, ranked: true });
}
export function startChallenge(c: (typeof P.CHALLENGES)[number]): void {
  newRun("challenge", { seed: R.hashStr("challenge-" + c.id), difficulty: c.difficulty, goals: c.goals, desc: c.desc, ranked: true });
}
export function dailyDone(): { score: number } | undefined {
  return (save().daily as Record<string, { score: number }>)[platform.utcDate()];
}
export function startSetup(): void {
  const m = app.setupMode;
  if (m === "learn") newRun("learn", { seed: R.hashStr("learn"), difficulty: "easy" });
  else if (m === "daily") {
    const d = platform.utcDate();
    // one ranked run per day: a repeat attempt is a replay, and must not submit
    newRun("daily", { seed: R.hashStr("orchard-daily-" + d), difficulty: "normal", ranked: !dailyDone() });
  } else if (m === "practice") {
    newRun("practice", { seed: (Math.random() * 2 ** 32) >>> 0, difficulty: ["easy", "normal", "hard"][app.practiceDiff] ?? "normal" });
  }
}
export function openSetup(mode: SetupMode): void {
  app.setupMode = mode;
  run.phase = "setup";
  if (mode === "scores") {
    app.boardRows = null;
    if (platform.signedIn()) void platform.boardEntries(50).then((rows) => { app.boardRows = rows; });
  }
  showScreen("setup");
}
/** Play is the dominant action: first-timers get the tutorial, returning players the journey stage picker. */
export function play(): void { audio.sfx.click(); openSetup(save().settings.tutorialDone ? "journey" : "learn"); }
export function gotoTitle(): void {
  app.pendingNext = null;
  run.phase = "title";
  showScreen("title");
}
export function pauseGame(): void {
  if (run.phase !== "active") return;
  run.phase = "paused";
  run.pauseAt = platform.nowMs();
  serializeResume();
  showScreen("pause", "btn-resume");
}
export function resumeGame(): void {
  run.pausedMs += platform.nowMs() - run.pauseAt;
  run.phase = "active";
  showScreen(null);
}
export function leaveRun(): void {
  run.state = null;
  run.phase = "title";
  app.warn = false;
  gotoTitle();
}
export function restartRun(): void { newRun(run.mode, run.modeOpts); }
export function nextStage(): void { if (app.pendingNext != null) startStage(app.pendingNext); }
export function openSettings(): void { showScreen("settings"); }
export function openHelp(): void { showScreen("help"); }
export function closeSettings(): void { audio.sfx.click(); if (run.phase === "paused") showScreen("pause"); else gotoTitle(); }
export function closeHelp(): void {
  if (run.phase === "paused") showScreen("pause");
  else if (run.phase === "title") showScreen("title");
  else gotoTitle();
}
export function signIn(): void { void requestSignIn().catch(() => undefined); }
export function copyInvite(): void {
  const link = platform.inviteLink();
  if (!link) return;
  let ok = false;
  try { clipboard.writeText(link); ok = true; } catch { ok = false; }
  toast(ok ? () => account().copied : () => account().copyFailed);
}

// ------------------------------------------------------------------ input
// Keys and pad buttons (starhermit.txt control.* / engine.gamepad.*). While a widget has key focus (Tab), the
// keyboard's aim and drop keys are the UI's (Space/Enter press the focused button, arrows move the slider); the pad
// still plays. A click or tap on a HUD button hands the keys back.
const AIM_STEP = 0.5;
const held = { action: "", since: 0 };
onAction((e) => {
  if (e.action === "pause") {
    if (!e.pressed || fresh(0)) return;
    if (run.phase === "active") pauseGame();
    else if (run.phase === "paused" && app.screen === "pause") resumeGame();
    return;
  }
  if (!e.pressed) { if (held.action === e.action) held.action = ""; return; }
  if (run.phase !== "active") return;
  const uiKeys = e.source === "keyboard" && ui.focused() !== null;
  switch (e.action) {
    case "aimleft": case "aimright":
      if (uiKeys) return;
      setAim(run.aimX + (e.action === "aimleft" ? -AIM_STEP : AIM_STEP));
      held.action = e.action;
      held.since = 0;
      break;
    case "drop": if (!uiKeys) tryDrop(run.aimX); break;
    case "undo": undo(); break;
    case "hint": showHint(); break;
    case "restart": restartRun(); break;
    default: break;
  }
});
/** A held aim key repeats as the browser's key repeat did (after 0.4 s, every 3 fixed steps). */
function aimRepeat(): void {
  if (!held.action || run.phase !== "active") { held.action = ""; return; }
  if (!isDown(held.action)) { held.action = ""; return; }
  held.since++;
  if (held.since >= 24 && (held.since - 24) % 3 === 0) setAim(run.aimX + (held.action === "aimleft" ? -AIM_STEP : AIM_STEP));
}

// The crate: a press on the stall (not on a widget) aims at the pointer's x on the fruit plane, a drag follows
// it, the release drops there. Presses are queued and decided once the frame's UI is built, so a press on a
// widget is the widget's.
interface Press { kind: "down" | "move" | "up" | "cancel"; x: number; y: number }
const queued: Press[] = [];
let dragging = false;
let lastTouch = -10;
let pointerUpFrame = -10;
/** A pointer button or finger lifted this frame or the last (a click or tap activates on its release). */
export function pointerActivation(): boolean { return frame().frame - pointerUpFrame <= 1; }
onPointerButton((e) => {
  if (!e.pressed) pointerUpFrame = frame().frame;
  if (e.button !== 0 || now() - lastTouch < 0.6) return;
  queued.push({ kind: e.pressed ? "down" : "up", x: e.x, y: e.y });
});
onPointerMove((x, y) => { if (dragging && now() - lastTouch >= 0.6) queued.push({ kind: "move", x, y }); });
onTouch((e) => {
  if (!e.primary || e.control) return;
  lastTouch = now();
  if (e.phase === "end") pointerUpFrame = frame().frame;
  queued.push({ kind: e.phase === "start" ? "down" : e.phase === "move" ? "move" : e.phase === "end" ? "up" : "cancel", x: e.x, y: e.y });
});
function aimTo(x: number, y: number): void { const ax = render.aimAt(x, y); if (ax !== null) setAim(ax); }
function crateInput(): void {
  for (const q of queued.splice(0)) {
    if (q.kind === "cancel") { dragging = false; continue; }
    if (q.kind === "down") {
      dragging = false;
      if (run.phase !== "active" || app.screen !== null || ui.pointerOver()) continue;
      dragging = true;
      aimTo(q.x, q.y);
      ui.setFocus(null);
      continue;
    }
    if (!dragging) continue;
    if (run.phase !== "active") { dragging = false; continue; }
    aimTo(q.x, q.y);
    if (q.kind === "up") { dragging = false; tryDrop(run.aimX); }
  }
}

// ------------------------------------------------------------------ lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}:${options.palette}`;
  if (k === lookKey) return;
  lookKey = k;
  const colors = (P.PALETTES as Record<string, (string | null)[]>)[options.palette] ?? P.PALETTES.default;
  render.applyLook(lookFor(f.quality, f.levelIndex), colors);
}

onStart(() => {
  initStyles();
  platform.initPlatform();
  audio.loadSfx();
  render.setReducedMotion(preferences().reducedMotion);
  applyLook();
  gotoTitle();
});
platform.onOptionsChange(() => applyLook());
platform.onMerged(() => { if (run.phase === "title") gotoTitle(); });
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
onSessionEnded(() => toast(() => account().signedOut));
onSuspend(() => {
  if (run.phase === "active") serializeResume();
  audio.setSuspended(true);
  platform.flush();
});
onResume(() => audio.setSuspended(false));
onQuit(() => { if (run.phase === "active" || run.phase === "paused") serializeResume(); platform.flush(); });

/** The 60 Hz simulation (the browser build's accumulator loop): the countdown, the rules' steps while the run is
 * live (a fast-forward runs up to 240 a frame), the results' delay. */
onFixedUpdate(() => {
  const c = app.countdown;
  if (c && run.phase === "countdown") {
    if (--c.ticks <= 0) {
      c.n--;
      if (c.n > 0) { c.ticks = 42; audio.sfx.countdown(c.n); }
      else if (c.n === 0) { c.ticks = 24; audio.sfx.countdown(0); }
      else { app.countdown = null; run.phase = "active"; }
    }
    return;
  }
  if (run.phase === "resolving") {
    if (--run.resolveIn <= 0) showResults();
    return;
  }
  const s = run.state;
  if (!s || run.phase !== "active") return;
  aimRepeat();
  R.step(s);
  drainEvents();
  if (run.settling > 0 && run.state === s) {
    let n = 0;
    while (run.settling > 0 && run.phase === "active" && n < 240) {
      if (settled(s)) { run.settling = 0; break; }
      R.step(s);
      drainEvents();
      run.settling--;
      n++;
    }
  }
});

let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  applyLook();
  applyContrast(ui.preferences().highContrast);
  audio.update();
  if (app.toast && app.toast.until < now()) app.toast = null;
});
onRender(() => {
  drawScreens();
  crateInput();
  render.update(frameDt, {
    state: run.state, aimX: run.aimX, preview: canDrop(), hot: !!run.state && run.state.aboveLineTicks > 0,
  });
});
