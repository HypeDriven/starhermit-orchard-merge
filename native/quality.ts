// The look per graphics level: the browser build's four presets and budgets
// (src/gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU
// its Auto gave it) keyed by the runtime's quality tier (frame().quality),
// with the merge sparks and pollen motes scaled within the tier by the level
// (frame().levelIndex), as the browser build scaled them by its hardware level
// (at most 2×). The runtime owns the rest of what the old Settings › Graphics
// section did: Auto and the level choice, render scale and the pixel-ratio
// cap, adaptive resolution, the frame-rate limit and readout, the GPU summary.
// The old section's per-category overrides are not offered (the runtime's
// Options choose a level).
import type { QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget {
  /** Stall and fruit shading: Lambert (Low), Standard (Balanced), physical glossy skins (High, Ultra). */
  material: "lambert" | "standard" | "physical";
  /** Fruit sphere segments [width, height]. */
  sphere: [number, number];
  /** Fruit-skin micro-relief (bump + roughness map). */
  skinBump: boolean;
  /** Procedural texture scale: the baked images (1 or 2). */
  texture: 1 | 2;
  /** Orchard trees as a share of the full grove; hanging fruit per tree. */
  trees: number; fruitPerTree: number;
  /** Juice droplets in the pool at Particles "high"; pollen motes. */
  sparks: number; motes: number;
  bloomRes: number; aoRes: number;
}
export interface Look {
  preset: QualityTier;
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
  grade: boolean;
  antialias: AntialiasMode;
  reflections: boolean;
  /** Procedural textures, glossy fruit skins, the orchard backdrop. */
  detailed: boolean;
  /** Merge-burst droplets in the pool (0: no bursts). */
  sparks: number;
  /** Drifting clouds and pollen motes. */
  animated: boolean;
  budget: Budget;
}

const TABLE: Record<QualityTier, Omit<Look, "preset" | "budget" | "sparks"> & { share: number }> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "off", reflections: false, detailed: false, share: 0, animated: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", reflections: true, detailed: true, share: 0.4, animated: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, detailed: true, share: 1, animated: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, detailed: true, share: 1, animated: true },
};
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", sphere: [20, 14], skinBump: false, texture: 1, trees: 0.5, fruitPerTree: 2, sparks: 100, motes: 40, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", sphere: [28, 20], skinBump: false, texture: 1, trees: 0.5, fruitPerTree: 3, sparks: 120, motes: 60, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", sphere: [40, 28], skinBump: true, texture: 1, trees: 1, fruitPerTree: 6, sparks: 160, motes: 90, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", sphere: [56, 36], skinBump: true, texture: 2, trees: 1, fruitPerTree: 8, sparks: 240, motes: 150, bloomRes: 1, aoRes: 1 },
};
export const SPARK_MAX = 480;
export const MOTE_MAX = 300;
/** The first level index of each tier. */
const TIER_FLOOR: Record<QualityTier, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };

/** The look for a quality tier at a level index (0 … 9). */
export function lookFor(preset: QualityTier, levelIndex: number): Look {
  const b = { ...BUDGETS[preset] };
  // Levels are about 1.64× apart in GPU throughput: the budgets grow with the level above the tier's first,
  // at most 2× (gfx.js budgetFor).
  const k = Math.min(2, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.sparks = Math.min(SPARK_MAX, Math.round(b.sparks * k));
  b.motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  const { share, ...row } = TABLE[preset];
  return { preset, ...row, sparks: Math.round(b.sparks * share), budget: b };
}
