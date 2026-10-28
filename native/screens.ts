// The browser build's DOM (index.html: the HUD, the screens, the banners) as
// starhermit:ui, built every frame over the 3D stall: the title, the mode
// setup (Tutorial, Journey's 40 stages, Daily, Practice's difficulty,
// Challenge's three variants, Score chase's local best runs and the global
// board), the pause, results, settings and help cards over a dimmed stall,
// and the HUD of a run. The browser's media queries are layouts picked by the
// window's logical size: desktop (≥ 1024 px: the objective and board rail on
// the left, the score and control rail on the right), compact (the top bar
// with the score and fruit badges, the thumb tray with the aim slider and
// buttons at the bottom) and short landscape (≤ 500 px tall: the tray in one
// row). Plus the warning banner, the countdown and the toast.
import { frame, openMenu } from "starhermit:engine";
import { bindings, requestRebind } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { R } from "./rules.ts";
import * as P from "../src/progress.js";
import { account, N, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import {
  app, canDrop, canUndo, closeHelp, closeSettings, copyInvite, dailyDone, fresh, gotoTitle, journeyStage, lbLine, leaveRun,
  nextStage, objectiveText, openHelp, openSettings, openSetup, options, pauseGame, play, pointerActivation, restartRun,
  resultsHeadline, resumeGame, resumeRun, run, save, setAim, showHint, signIn, skipSettle, startChallenge, startSetup,
  startStage, tierName, tryDrop, undo,
} from "./main.ts";

// ------------------------------------------------------------------ layout and helpers
interface Layout { lw: number; lh: number; sc: number; ox: number; oy: number; desktop: boolean; shortLand: boolean }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  return { lw, lh, sc, ox: sa.left, oy: sa.top, desktop: lw >= 1024, shortLand: lw < 1024 && lh <= 500 && lw > lh };
}
const lastSize = new Map<string, number>();
const prefs = (): ui.UiPreferences => ui.preferences();
function tw(text: string, style: string | (string | ui.Style)[], kind?: "button" | "heading"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style }).width / prefs().scale;
}
/** Text without the old markup (<strong>…</strong>), which the engine's labels do not take. */
const plain = (s: string): string => s.replace(/<\/?strong>/g, "");

const KEY_GLYPHS: Record<string, string> = { "Arrow Left": "←", "Arrow Right": "→", "Arrow Up": "↑", "Arrow Down": "↓", Escape: "Esc", "Numpad Enter": "Num Enter" };
/** keyLabel / reflectKeys: an action's effective keys, e.g. "←/A". */
export function keysFor(action: string): string {
  let list: readonly { device: string; label: string }[] = [];
  try { list = bindings(action); } catch { list = []; }
  const names = list.filter((b) => b.device === "keyboard").map((b) => KEY_GLYPHS[b.label] ?? b.label);
  return [...new Set(names)].join("/") || "—";
}
const firstKey = (action: string): string => keysFor(action).split("/")[0]!;

let firstId: string | null = null;
interface Btn { id: string; text: string; cls?: string; size?: number; kbd?: string; disabled?: boolean; tip?: string; act: () => void }
const PAD_X = 40;
const btnW = (b: Btn): number => tw(b.text, [b.cls ?? "btn", ...(b.size ? [{ text: { size: b.size } } as ui.Style] : [])]) + (b.kbd ? tw(b.kbd, "kbd") + 22 : 0) + PAD_X;
/** A button `width` wide (null: its text's); a long label wraps inside; `kbd` adds the key chip. */
function button(b: Btn, width: number | null = null): boolean {
  const cls = b.cls ?? "btn";
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  if (b.tip) opts.tooltip = b.tip;
  const inner = width != null ? Math.max(20, width - PAD_X) : null;
  const wraps = inner != null && btnW(b) > width!;
  const weight = cls === "primary" ? "700" : "400";
  const align = cls === "choice" ? "start" : "center";
  if (b.kbd || wraps || b.size) {
    opts.content = () => {
      const txt = { text: { align, weight, size: b.size ?? 16 } } as ui.Style;
      if (wraps && !b.kbd) { ui.style(txt).paragraph(b.text, inner!); return; }
      ui.row(`${b.id}-face`, () => {
        if (wraps) ui.style(txt).paragraph(b.text, Math.max(20, inner! - tw(b.kbd ?? "", "kbd") - 22));
        else ui.style(txt).label(b.text);
        if (b.kbd) ui.style("kbd-box").row(`${b.id}-kbd`, () => { ui.style("kbd").label(b.kbd!); });
      }, { spacing: 6, align: "center" });
    };
  }
  if (!firstId && !b.disabled) firstId = b.id;
  const hit = ui.style(cls, width != null ? { width } : {}).id(b.id).button(b.text, opts);
  if (hit && !fresh(0)) { b.act(); if (app.screen === null && pointerActivation()) ui.setFocus(null); }
  return hit;
}
/** Buttons at their own widths in rows that wrap at `width` (CSS flex-wrap). */
function flow(label: string, list: Btn[], width: number, gap = 10, align: "start" | "center" = "start"): void {
  const rows = wrapRows(list.map((b) => Math.min(width, btnW(b))), width, gap);
  let k = 0;
  ui.column(label, () => {
    rows.forEach((n, ri) => ui.row(`${label}-r${ri}`, () => {
      for (let i = 0; i < n; i++, k++) { const b = list[k]!; button(b, btnW(b) > width ? width : null); }
    }, { spacing: gap, align: "center" }));
  }, { spacing: gap, align, width });
}
function wrapRows(widths: number[], max: number, gap: number): number[] {
  const rows: number[] = [];
  let used = 0, n = 0;
  for (const w of widths) {
    if (n && used + gap + w > max) { rows.push(n); used = 0; n = 0; }
    used += (n ? gap : 0) + w;
    n++;
  }
  if (n) rows.push(n);
  return rows;
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls = "p", id?: string, center = false): void {
  if (!text) return;
  const styles: (string | ui.Style)[] = [cls];
  if (center) styles.push({ text: { align: "center" } });
  let u = ui.style(...styles);
  if (id) u = u.id(id);
  if (tw(text, styles) <= width) u.label(text);
  else u.paragraph(text, width);
}
function heading(cls: string, text: string, width: number, center = false): void {
  const styles: (string | ui.Style)[] = [cls];
  if (center) styles.push({ text: { align: "center" } });
  if (tw(text, cls, "heading") <= width) {
    if (center) ui.row(`${cls}-${text}-c`, () => { ui.style(cls).heading(text); }, { width, justify: "center" });
    else ui.style(cls).heading(text);
  } else ui.style(...styles).paragraph(text, width);
}

// ------------------------------------------------------------------ the frame
export function drawScreens(): void {
  const L = layoutNow();
  const f = frame();
  firstId = null;
  const inRun = !!run.state && (run.phase === "countdown" || run.phase === "active" || run.phase === "resolving" || (run.phase === "paused" && app.screen === null));
  if (inRun && app.screen === null) hud(L);
  if (app.warn && run.state && app.screen === null) warnBanner(L);
  if (app.countdown && app.screen === null) {
    const c = app.countdown;
    const text = c.n > 0 ? String(c.n) : T("Go!");
    ui.place("countdown", "center", () => {
      ui.style({ text: { size: 96, weight: "900", color: "$accent", align: "center" } }).id("countdown").label(text);
    });
  }
  if (app.screen) {
    draw.box(0, 0, f.width, f.height, "scrim");
    const builders: Record<string, (w: number) => void> = {
      title: titleCard, setup: setupCard, pause: pauseCard, results: resultsCard, settings: settingsCard, help: helpCard,
    };
    card(app.screen, L, builders[app.screen]!, app.screen === "title" || app.screen === "pause");
  }
  toast(L);
  if (app.focusNext) {
    const age = f.frame - app.openedFrame;
    const target = app.focusNext === "first" ? firstId : app.focusNext;
    if (age >= 1 && target) ui.setFocus(target);
    if (age >= 3) app.focusNext = null;
  }
}

/** A screen's card (index.html .screen > .card): centred, at most 640 wide, scrolling when taller than the window. */
function card(key: string, L: Layout, build: (w: number) => void, center = false): void {
  const pad = L.lw < 480 ? 16 : 24;
  const outer = Math.min(640, L.lw - 32);
  const avail = L.lh - 32;
  const h = lastSize.get(key) ?? 0;
  const scroll = h > avail;
  const inner = outer - 2 * pad - 4 - (scroll ? 14 : 0);
  ui.place(`card-${key}`, "center", () => {
    const body = (): void => {
      const r = ui.style("card", { width: outer, padding: pad }).id(`scr-${key}`).column(`${key}-card`, () => build(inner), { width: outer, spacing: center ? 14 : 10, align: center ? "center" : "start" });
      lastSize.set(key, r.height / L.sc);
    };
    if (scroll) ui.scrollArea(`${key}-scroll`, { width: outer + 14, height: avail }, body, fresh(6) ? { scrollTo: { top: 0 } } : undefined);
    else body();
  });
}

// ------------------------------------------------------------------ title
function titleCard(w: number): void {
  const s = save();
  heading("h1", "🍑 Orchard Merge", w, true);
  para(T("A deterministic physics merge puzzle."), w, "muted", "title-sub", true);
  const r = s.resume as null | { savedAt: number };
  if (r) {
    const mins = Math.floor(Math.max(0, platform.nowMs() - r.savedAt) / 60000);
    para(mins === 1 ? T("While you were away: 1 minute since your last run.") : T("While you were away: {n} minutes since your last run.", { n: mins }), w, "small", "away-line", true);
  }
  para(profileLine(), w, "small", "profile-line", true);
  if (r) button({ id: "bt-resume", text: T("Resume last run"), cls: "primary", act: resumeRun }, w);
  button({ id: "bt-play", text: T("▶ Play"), cls: "primary", size: 21, act: play }, w);
  flow("title-modes", [
    { id: "bt-daily", text: T("Daily"), act: () => openSetup("daily") },
    { id: "bt-journey", text: T("Journey"), act: () => openSetup("journey") },
    { id: "bt-practice", text: T("Practice"), act: () => openSetup("practice") },
    { id: "bt-challenge", text: T("Challenge"), act: () => openSetup("challenge") },
  ], w, 10, "center");
  flow("title-more", [
    { id: "bt-learn", text: T("Tutorial"), act: () => openSetup("learn") },
    { id: "bt-scores", text: T("Score chase"), act: () => openSetup("scores") },
    { id: "bt-settings", text: T("Settings"), act: openSettings },
    { id: "bt-help", text: T("Help"), act: openHelp },
  ], w, 10, "center");
  const acct: Btn[] = [];
  if (!platform.signedIn()) acct.push({ id: "bt-sh-signin", text: account().signIn, act: signIn });
  if (platform.inviteLink()) acct.push({ id: "bt-sh-invite", text: account().invite, act: copyInvite });
  if (acct.length) flow("title-account", acct, w, 10, "center");
}
function profileLine(): string {
  const st = platform.syncState();
  if (st === "local") return T("Guest — progress is stored on this device.");
  const status = st === "saving" ? T("cloud save: saving…") : st === "synced" ? T("cloud save: synced") : st === "error" ? T("cloud save unreachable — progress is safe on this device") : T("Signed in.");
  return T("Playing as {name} — {status}", { name: platform.displayName(T("Player")), status });
}

// ------------------------------------------------------------------ setup
function setupCard(w: number): void {
  const m = app.setupMode;
  const s = save();
  let start: string | null = T("Start");
  if (m === "learn") {
    heading("h2", T("Learn"), w);
    para(T("A 3-step interactive tutorial. About 2 minutes. Not ranked."), w);
  } else if (m === "journey") {
    heading("h2", T("Journey"), w);
    para(T("40 staged goals. ~3–5 minutes each. Ranked per stage."), w);
    const gap = 8;
    const cols = Math.max(1, Math.floor((w + gap) / (76 + gap)));
    const cw = (w - gap * (cols - 1)) / cols;
    ui.id("journey-grid").grid(T("Journey"), () => {
      for (let i = 0; i < P.JOURNEY_COUNT; i++) {
        const st = journeyStage(i);
        const unlocked = i + 1 <= s.journey.unlocked;
        const cleared = (s.journey.cleared as Record<string, number>)[i] != null;
        const text = String(i + 1) + (cleared ? " ★" : "");
        const tip = T("Stage {n}: score {score}, tier {tier}, {drops} drops", { n: i + 1, score: st.goals.targetScore, tier: st.goals.requireTier, drops: st.goals.maxDrops });
        if (!firstId && unlocked) firstId = `stage-${i + 1}`;
        const hit = ui.style("stage", { width: cw }).id(`stage-${i + 1}`).button(text, { disabled: !unlocked, tooltip: tip });
        if (hit && !fresh(0)) startStage(i);
      }
    }, { columns: cols, gap, width: w });
    start = null;
  } else if (m === "daily") {
    heading("h2", T("Daily"), w);
    const done = dailyDone();
    para(plain(T("Seed from UTC date <strong>{date}</strong>. One ranked run per day; ~4 minutes.", { date: platform.utcDate() })), w);
    para(done ? plain(T("Best today: <strong>{score}</strong>", { score: done.score })) : T("Not attempted yet today."), w, "p", "daily-best");
    start = done ? T("Replay (unranked)") : T("Start");
  } else if (m === "practice") {
    heading("h2", T("Practice"), w);
    para(T("Free play with undo. Not ranked. Restart anytime."), w);
    const opts = [T("Easy"), T("Normal"), T("Hard")];
    const pick = ui.id("practice-diff").select(T("Difficulty"), app.practiceDiff, opts, { width: Math.min(w, 260) } as ui.WidgetOptions);
    if (pick !== app.practiceDiff) app.practiceDiff = pick;
  } else if (m === "challenge") {
    heading("h2", T("Challenge"), w);
    para(T("Preset rule variants. Ranked locally."), w);
    for (const c of P.CHALLENGES) {
      const text = `${T(c.name)} — ${T(c.desc)}`;
      button({ id: `ch-${c.id}`, text, cls: "choice", act: () => startChallenge(c) }, w);
    }
    start = null;
  } else {
    heading("h2", T("Score chase"), w);
    scores(w);
    start = null;
  }
  const row: Btn[] = [];
  if (start) row.push({ id: "setup-start", text: start, cls: "primary", act: startSetup });
  row.push({ id: "setup-back", text: T("Back"), act: gotoTitle });
  flow("setup-actions", row, w);
}

/** A table (index.html <table>): a header row and rows, columns sized to their longest cell. */
function table(id: string, headers: string[], rows: string[][], w: number): void {
  const cols = headers.length;
  const want = headers.map((h, c) => Math.max(tw(h, "th"), ...rows.map((r) => tw(r[c] ?? "", "td"))) + 16);
  const sum = want.reduce((a, b) => a + b, 0);
  const k = sum > w ? w / sum : 1;
  const cw = want.map((x) => x * k);
  const cell = (text: string, c: number, cls: string, key: string): void => {
    ui.style("row-line", { width: cw[c]! }).row(key, () => {
      if (tw(text, cls) <= cw[c]! - 16) ui.style(cls).label(text);
      else ui.style(cls).paragraph(text, cw[c]! - 16);
    }, { width: cw[c]! });
  };
  ui.id(id).column(id, () => {
    ui.row(`${id}-h`, () => headers.forEach((h, c) => cell(h, c, "th", `${id}-h${c}`)), { spacing: 0, width: w });
    rows.forEach((r, ri) => ui.row(`${id}-r${ri}`, () => r.forEach((v, c) => cell(v, c, "td", `${id}-r${ri}c${c}`)), { spacing: 0, width: w }));
  }, { spacing: 0, width: w });
  void cols;
}

function scores(w: number): void {
  const s = save();
  para(T("Local best runs (top 50 across modes). Replay data stored with each entry."), w);
  const lb = s.leaderboard as { mode: string; score: number; difficulty: string; hash: number; date: string }[];
  const rows = lb.slice(0, 20).map((e, i) => [
    String(i + 1), T((P.MODE_NAMES as Record<string, string>)[e.mode] ?? e.mode), String(e.score),
    T((P.DIFF_NAMES as Record<string, string>)[e.difficulty] ?? e.difficulty), (e.hash >>> 0).toString(16), String(e.date).slice(0, 10),
  ]);
  if (rows.length) table("local-board", ["#", T("Mode"), T("Score"), T("Difficulty"), T("Hash"), T("Date")], rows, w);
  else para(T("No ranked runs yet."), w, "muted", "no-runs");
  // Signed in: the high-score board (ranked runs post to it from the results).
  const g = app.boardRows;
  if (g && g.length) {
    heading("h3", T("Global board"), w);
    table("global-board", ["#", T("Player"), T("Score")], g.map((r) => [String(r.rank), r.name, String(r.score)]), w);
  }
}

// ------------------------------------------------------------------ pause, results, settings, help
function pauseCard(w: number): void {
  heading("h2", T("Paused"), w, true);
  button({ id: "btn-resume", text: T("Resume"), cls: "primary", act: resumeGame }, w);
  button({ id: "bp-restart", text: T("Restart"), kbd: firstKey("restart"), act: restartRun }, w);
  button({ id: "bp-settings", text: T("Settings"), act: openSettings }, w);
  button({ id: "bp-help", text: T("Help"), act: openHelp }, w);
  button({ id: "bp-leave", text: T("Leave run"), cls: "danger", act: leaveRun }, w);
}

function resultsCard(w: number): void {
  const r = app.result;
  if (!r) return;
  const bd = r.bd;
  heading("h2", resultsHeadline(), w);
  const rows: [string, string, boolean][] = [
    [T("Merge score"), String(bd.mergeScore), false],
    [T("Max tier bonus"), String(bd.maxTierBonus), false],
    [T("Total"), String(bd.total), true],
    [T("Drops"), String(bd.drops), false],
    [T("Merges"), String(bd.merges), false],
    [T("Max tier"), `${bd.maxTier} (${tierName(bd.maxTier)})`, false],
    [T("Invalid actions"), String(bd.invalidActions), false],
    [T("Ticks"), String(bd.ticks), false],
    [T("Final hash"), (r.hash >>> 0).toString(16), false],
  ];
  const vw = Math.max(...rows.map(([, v]) => tw(v, "th"))) + 20;
  ui.id("res-breakdown").column("res-breakdown", () => {
    rows.forEach(([k, v, strong], i) => {
      ui.style("row-line", { width: w }).row(`res-row-${i}`, () => {
        para(k, w - vw - 16, strong ? "th" : "td");
        ui.spacer();
        ui.style(strong ? "th" : "td").id(`res-v-${i}`).label(v);
      }, { width: w, align: "center" });
    });
  }, { spacing: 0, width: w });
  const s = save();
  const total = Object.keys(P.ACHIEVEMENTS).length;
  const got = Object.keys(s.achievements).length;
  para(T("Achievements: {got}/{total} unlocked.", { got, total }), w, "small", "res-achievements");
  for (const k of run.newAchievements) para(`🏅 ${T((P.ACHIEVEMENTS as Record<string, string>)[k]!)}`, w, "small", `ach-${k}`);
  const lb = lbLine();
  if (lb) para(lb, w, "small", "res-lb");
  const acts: Btn[] = [{ id: "btn-retry", text: T("Retry"), cls: "primary", act: restartRun }];
  if (app.pendingNext != null) acts.push({ id: "br-next", text: T("Next stage"), act: nextStage });
  acts.push({ id: "br-title", text: T("Back to title"), act: () => { run.state = null; gotoTitle(); } });
  flow("res-actions", acts, w);
}

function settingsCard(w: number): void {
  heading("h2", T("Settings"), w);
  const cur = options.haptics;
  const nxt = ui.id("set-haptics").checkbox(T("Haptics (vibrate on merge)"), cur);
  if (nxt !== cur && !fresh(0)) platform.setOption("haptics", nxt);
  const sw = Math.min(260, w * 0.55);
  ui.row("palette-row", () => {
    para(T("Color palette"), w - sw - 12, "p");
    ui.spacer();
    const names = P.PALETTE_NAMES.map(([, n]) => T(n));
    const idx = Math.max(0, P.PALETTE_NAMES.findIndex(([id]) => id === options.palette));
    const pick = ui.id("set-palette").select(T("Color palette"), idx, names, { width: sw } as ui.WidgetOptions);
    if (pick !== idx) platform.setOption("palette", P.PALETTE_NAMES[pick]![0]);
  }, { width: w, align: "center" });
  para(T("Sound, graphics quality, language, reduced motion, high contrast and larger text are in the StarHermit Options."), w, "small", "options-note");
  flow("set-options", [
    { id: "btn-options", text: T("Audio, graphics & accessibility"), act: () => openMenu() },
    { id: "btn-rebind", text: T("Controls"), act: () => requestRebind() },
  ], w);
  button({ id: "set-close", text: T("Done"), cls: "primary", act: closeSettings }, w);
}

// The old help markup's keys (index.html data-i18n-html): their <span class="kbd" data-key-action> show the effective keys.
const HELP_CONTROLS = N('Drag / aim slider, <span class="kbd" data-key-action="aimLeft">←</span><span class="kbd" data-key-action="aimRight">→</span> aim, <span class="kbd" data-key-action="drop">Space</span> drop, <span class="kbd" data-key-action="undo">U</span> undo (practice), <span class="kbd" data-key-action="hint">H</span> hint, <span class="kbd" data-key-action="pause">P</span> pause, <span class="kbd" data-key-action="restart">R</span> restart.');
const HELP_MODES = N('<strong>Learn</strong>: guided tutorial. <strong>Journey</strong>: 40 staged goals. <strong>Daily</strong>: one ranked run per UTC day. <strong>Practice</strong>: relaxed, with undo. <strong>Challenge</strong>: preset rule variants.');
function rich(html: string): string {
  return plain(html).replace(/<span class="kbd" data-key-action="(\w+)">[^<]*<\/span>/g, (_m, a: string) => ` ${keysFor(a.toLowerCase())} `)
    .replace(/<[^>]+>/g, "").replace(/ {2,}/g, " ").replace(/^ /, "");
}
function helpCard(w: number): void {
  heading("h2", T("How to play"), w);
  const panels: [string, string][] = [
    [T("Drop"), T("Aim along the top of the crate, release to drop the current fruit. Matching tiers merge into the next tier and score points (tier² × 5).")],
    [T("Warning line"), T("If settled fruit stays above the glowing line for the grace period, the run overflows and ends.")],
    [T("Controls"), rich(T(HELP_CONTROLS))],
    [T("Modes"), rich(T(HELP_MODES))],
  ];
  panels.forEach(([h, p], i) => {
    ui.style("inset", { width: w }).column(`help-${i}`, () => {
      heading("h3", h, w - 28);
      para(p, w - 28, "p", `help-p-${i}`);
    }, { width: w, spacing: 6 });
  });
  button({ id: "help-close", text: T("Close"), cls: "primary", act: closeHelp }, w);
}

// ------------------------------------------------------------------ the HUD
function hud(L: Layout): void {
  if (L.desktop) {
    const railW = L.lw >= 1200 ? 240 : 200;
    rail("rail-left", "top-start", railW, L, leftRail);
    rail("rail-right", "top-end", railW, L, rightRail);
  } else {
    topBar(L);
    thumbTray(L);
  }
}
function rail(key: string, anchor: "top-start" | "top-end", w: number, L: Layout, build: (w: number) => void): void {
  const natural = lastSize.get(key) ?? 0;
  const avail = L.lh - 16;
  const scroll = natural > avail;
  ui.place(key, { anchor, x: 8, y: 8 }, () => {
    const body = (): void => {
      const r = ui.column(`${key}-col`, () => build(w - (scroll ? 14 : 0)), { width: w - (scroll ? 14 : 0), spacing: 10 });
      lastSize.set(key, r.height / L.sc);
    };
    if (scroll) ui.scrollArea(`${key}-scroll`, { width: w, height: avail }, body);
    else body();
  });
}
function leftRail(w: number): void {
  const iw = w - 28;
  ui.style("panel", { width: w }).id("objective-panel").column(T("Objective"), () => {
    para(T("Objective"), iw, "small", "objective-h");
    para(objectiveText(), iw, "p", "objective");
  }, { width: w, spacing: 4 });
  ui.style("panel", { width: w }).id("board-panel").column(T("Board"), () => {
    para(T("Board"), iw, "small", "board-h");
    boardList(iw, 160);
  }, { width: w, spacing: 4 });
}
/** The board list (index.html #board-list): the fruit by tier, a navigable text equivalent of the crate. */
function boardList(w: number, maxH: number): void {
  const s = run.state!;
  const sorted = s.fruits.slice().sort((a, b) => b.tier - a.tier || a.id - b.id);
  const items = sorted.length
    ? sorted.map((f, i) => `${i + 1}. ${T("{fruit} (tier {tier}) at x {x}, y {y}", { fruit: tierName(f.tier), tier: f.tier, x: f.x.toFixed(1), y: f.y.toFixed(1) })}`)
    : [T("Empty")];
  const est = lastSize.get("board-list") ?? 0;
  const scroll = est > maxH;
  const inner = w - (scroll ? 14 : 0) - 12;
  const body = (): void => {
    const r = ui.style("board-list", { width: w - (scroll ? 14 : 0) }).id("board-list").column(T("Fruits on the board"), () => {
      items.forEach((t, i) => para(t, inner, "small-ink", `board-item-${i}`));
    }, { width: w - (scroll ? 14 : 0), spacing: 2 });
    lastSize.set("board-list", r.height / prefs().scale);
  };
  if (scroll) ui.scrollArea("board-scroll", { width: w, height: maxH }, body);
  else body();
}
function fruitText(tier: number): string { return `${tierName(tier)} (${tier})`; }
function rightRail(w: number): void {
  const s = run.state!;
  const iw = w - 28;
  ui.style("panel", { width: w }).id("score-panel").column(T("Score"), () => {
    const c = (text: string, cls: string, id: string): void => para(text, iw, cls, id, true);
    c(T("Score"), "small", "score-h");
    c(String(s.score), "score-big", "score-big");
    c(T("Dropping now"), "small", "now-h");
    c(fruitText(s.currentTier), "fruit-big", "now-fruit");
    c(T("Next"), "small", "next-h");
    c(fruitText(s.nextTier), "fruit-big", "next-fruit");
  }, { width: w, spacing: 2, align: "center" });
  ui.style("panel", { width: w }).id("control-panel").column(T("Controls"), () => {
    para(T("Aim"), iw, "p", "aim-h");
    aimSlider("aim-slider", iw);
    button({ id: "btn-drop", text: T("Drop"), cls: "primary", kbd: firstKey("drop"), disabled: !canDrop(), act: () => tryDrop(run.aimX) }, iw);
    flow("rail-row1", [
      { id: "btn-undo", text: T("Undo"), kbd: firstKey("undo"), tip: T("Undo (practice)"), disabled: !canUndo(), act: undo },
      { id: "btn-hint", text: T("Hint"), kbd: firstKey("hint"), tip: T("Hint"), act: showHint },
    ], iw);
    flow("rail-row2", [
      { id: "btn-skip", text: T("Skip"), kbd: "⏩", tip: T("Fast-forward settling"), act: skipSettle },
      { id: "btn-pause", text: T("Pause"), kbd: firstKey("pause"), act: pauseGame },
    ], iw);
  }, { width: w, spacing: 10 });
}
function aimSlider(id: string, w: number): void {
  const v = ui.id(id).slider(T("Aim position"), run.aimX, { min: 1, max: 19, step: 0.05, width: w });
  if (Math.abs(v - run.aimX) > 1e-6 && !fresh(0)) setAim(v);
}

/** Compact: the top bar (score, the Now / Next badges, the objective) that wraps. */
function topBar(L: Layout): void {
  const s = run.state!;
  const w = L.lw - 12;
  const iw = w - 20;
  const items: [string, string, string][] = [
    ["score-top", String(s.score), "score-top"],
    ["now-top", T("Now: {fruit}", { fruit: fruitText(s.currentTier) }), "badge-text"],
    ["next-top", T("Next: {fruit}", { fruit: fruitText(s.nextTier) }), "badge-text"],
    ["objective-top", objectiveText(), "badge-text"],
  ];
  const widths = items.map(([, t, c], i) => Math.min(iw, tw(t, c) + (i ? 24 : 4)));
  const rows = wrapRows(widths, iw, 8);
  ui.place("topbar", { anchor: "top-start", x: 6, y: 6 }, () => {
    const r = ui.style("topbar", { width: w }).id("topbar").column(T("Score"), () => {
      let k = 0;
      rows.forEach((n, ri) => ui.row(`top-r${ri}`, () => {
        for (let i = 0; i < n; i++, k++) {
          const [id, text, cls] = items[k]!;
          if (k === 0) { ui.style(cls).id(id).label(text); continue; }
          ui.style("badge", { width: widths[k]! }).row(`${id}-b`, () => para(text, widths[k]! - 22, cls, id), { width: widths[k]! });
        }
      }, { spacing: 8, align: "center" }));
    }, { width: w, spacing: 6 });
    lastSize.set("topbar", r.height / L.sc);
  });
}
/** Compact: the thumb tray (aim slider, Drop, Hint, Undo, Skip, Pause); short landscape puts it in one row. */
function thumbTray(L: Layout): void {
  const w = L.lw - 12;
  const btns: Btn[] = [
    { id: "tt-drop", text: T("Drop"), cls: "primary", disabled: !canDrop(), act: () => tryDrop(run.aimX) },
    { id: "tt-hint", text: T("Hint"), act: showHint },
    { id: "tt-undo", text: T("Undo"), disabled: !canUndo(), act: undo },
    { id: "tt-skip", text: T("Skip"), tip: T("Fast-forward settling"), act: skipSettle },
    { id: "tt-pause", text: T("Pause"), act: pauseGame },
  ];
  const h = lastSize.get("tray") ?? 0;
  ui.place("tray", { anchor: "top-start", x: 6, y: Math.max(0, L.lh - h - 6) }, () => {
    const r = ui.column("tray-col", () => {
      if (L.shortLand) {
        const bw = btns.reduce((a, b) => a + btnW(b) + 8, 0);
        const aw = tw(T("Aim"), "p") + 10;
        const sw = Math.max(120, w - bw - aw);
        ui.row("tray-row", () => {
          para(T("Aim"), aw, "p", "tt-aim-h");
          aimSlider("tt-aim", sw);
          for (const b of btns) button(b);
        }, { spacing: 8, align: "center", width: w });
      } else {
        para(T("Aim"), w, "p", "tt-aim-h");
        aimSlider("tt-aim", w);
        flow("tray-btns", btns, w, 8, "center");
      }
    }, { width: w, spacing: 6 });
    lastSize.set("tray", r.height / L.sc);
  });
}

/** The warning banner (index.html #warn-banner): at the top on desktop, above the thumb tray when compact. */
function warnBanner(L: Layout): void {
  const text = T("⚠ Fruit above the line!");
  const w = Math.min(L.lw - 32, tw(text, "warn-text") + 36);
  const y = L.desktop ? 8 : Math.max(8, L.lh - (lastSize.get("tray") ?? 100) - 24 - 44);
  ui.place("warn", { anchor: "top", y }, () => {
    ui.style("warn-banner", { width: w }).id("warn-banner").row(text, () => para(text, w - 34, "warn-text", "warn-text", true), { width: w, justify: "center" });
  });
}

function toast(L: Layout): void {
  const t = app.toast;
  if (!t) return;
  const text = t.text();
  const w = Math.min(L.lw * 0.9, 420);
  ui.place("toast", { anchor: "bottom", y: 16 }, () => ui.style("toast", { width: w }).column("toast-col", () => para(text, w - 34, "toast-text", "sh-toast", true), { width: w, align: "center" }));
}
void R;
