// The deterministic rules (src/rules.js), the browser build's classic script
// shared with the Node tests and the dev server.js unchanged, evaluated as a
// classic script: its global OrchardRules is this module's API.
import { loadClassic } from "starhermit:script";

loadClassic("src/rules.js");

export interface Fruit { id: number; x: number; y: number; vx: number; vy: number; tier: number; age: number }
export interface Goals { targetScore?: number; requireTier?: number; maxDrops?: number; timeLimitTicks?: number }
export interface RulesEvent { kind: "drop" | "merge" | "warn" | "warn-clear" | "invalid" | "gameover"; tier?: number; x?: number; y?: number; points?: number; reason?: string; score?: number }
export interface State {
  version: number; seed: number; difficulty: string; tick: number; status: "active" | "over";
  terminalReason: null | "overflow" | "goal-complete" | "move-limit" | "resigned";
  fruits: Fruit[]; nextId: number; currentTier: number; nextTier: number; score: number; mergeScore: number;
  merges: number; maxTier: number; drops: number; invalidActions: number; cooldown: number; aboveLineTicks: number;
  goals: Goals | null; events: RulesEvent[];
}
export type Snapshot = Record<string, unknown> & { seed: number; difficulty: string; goals: Goals | null };
export interface Breakdown {
  mergeScore: number; maxTierBonus: number; efficiencyPerDrop: number; drops: number; merges: number; maxTier: number;
  invalidActions: number; ticks: number; total: number;
}
export interface RulesApi {
  RULES_VERSION: number; STEP_MS: number; WORLD_W: number; WORLD_H: number; WARN_Y: number; GRACE_TICKS: number;
  TIER_R: number[]; X_QUANTUM: number;
  hashStr(s: string): number;
  quantizeX(x: number): number;
  mergePoints(t: number): number;
  newGame(seed: number, opts?: { difficulty?: string; goals?: Goals | null }): State;
  legalActions(s: State): { drop: boolean; undo: boolean; hint: boolean; resign: boolean };
  hint(s: State): number;
  applyCommand(s: State, cmd: { kind: string; x?: number }): boolean;
  step(s: State): void;
  scoreBreakdown(s: State): Breakdown;
  snapshot(s: State): Snapshot;
  restore(snap: Snapshot): State;
  stateHash(s: State): number;
}
export const R = (globalThis as unknown as { OrchardRules: RulesApi }).OrchardRules;
