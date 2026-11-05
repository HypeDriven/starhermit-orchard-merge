// The look per graphics level. The engine's level table owns the engine effects
// (levelSettings(): shadows and their map size, AO, bloom, grade, anti-aliasing);
// the browser build's four presets (src/gfx.js TABLE / BUDGETS) keep the game-only
// art, keyed by the quality tier: materials, sphere segments, textures, orchard,
// reflections. The merge sparks and pollen motes scale with the level's particle
// budget against the tier's anchor level, at most 2× (gfx.js budgetFor). The runtime
// owns the rest of what the old Settings › Graphics section did: Auto and the level
// choice, render scale and the pixel-ratio cap, adaptive resolution, the frame-rate
// limit and readout, the GPU summary. The old section's per-category overrides are
// not offered (the runtime's Options choose a level).
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
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
}
export interface Look {
  preset: QualityTier;
  /** Key-light shadow map: the level's size (0 = off). */
  shadows: number;
  /** The level's AO (null = off). */
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution (null = off). */
  bloom: number | null;
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

type Art = Pick<Look, "reflections" | "detailed" | "animated"> & { share: number };
const ART: Record<QualityTier, Art> = {
  low: { reflections: false, detailed: false, share: 0, animated: false },
  balanced: { reflections: true, detailed: true, share: 0.4, animated: true },
  high: { reflections: true, detailed: true, share: 1, animated: true },
  ultra: { reflections: true, detailed: true, share: 1, animated: true },
};
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", sphere: [20, 14], skinBump: false, texture: 1, trees: 0.5, fruitPerTree: 2, sparks: 100, motes: 40 },
  balanced: { material: "standard", sphere: [28, 20], skinBump: false, texture: 1, trees: 0.5, fruitPerTree: 3, sparks: 120, motes: 60 },
  high: { material: "physical", sphere: [40, 28], skinBump: true, texture: 1, trees: 1, fruitPerTree: 6, sparks: 160, motes: 90 },
  ultra: { material: "physical", sphere: [56, 36], skinBump: true, texture: 2, trees: 1, fruitPerTree: 8, sparks: 240, motes: 150 },
};
export const SPARK_MAX = 480;
export const MOTE_MAX = 300;
/** Each tier's anchor level: its budgets are written for it. */
const ANCHOR: Record<QualityTier, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };

/** The look for a level's settings. Plain data: render.applyLook compares it as JSON. */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const b = { ...BUDGETS[preset] };
  // The level's particle budget against the anchor's: more droplets and motes above the anchor, at most 2× (gfx.js budgetFor).
  const k = Math.min(2, s.particles / levelSettings(ANCHOR[preset]).particles);
  b.sparks = Math.min(SPARK_MAX, Math.round(b.sparks * k));
  b.motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  const { share, ...art } = ART[preset];
  return {
    preset, ...art,
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
    sparks: Math.round(b.sparks * share),
    budget: b,
  };
}
