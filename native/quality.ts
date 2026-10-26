// The look per graphics level: the browser build's four presets and their
// 60 FPS budgets (js/gfx.js before the port: TABLE and BUDGETS) keyed by the
// runtime's quality tier (frame().quality), with the confetti and dust-mote
// budgets scaled within the tier by the level (frame().levelIndex), as the
// browser build scaled them by its hardware level (at most 4×, capped at the
// 260-chip / 48-mote pools). The runtime owns the rest of what the old
// Graphics panel did: Auto and the level choice, render scale and the
// pixel-ratio cap, adaptive resolution, the frame-rate limit and readout,
// and the shadow-map size and MSAA samples it holds to the level.
import type { QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export type Preset = QualityTier;
export interface Budget {
  /** Lambert on Low, standard PBR on Balanced, physical (clearcoat pins and strips) above. */
  material: "lambert" | "standard" | "physical";
  /** Desk texture size (px; the relief map is half). */
  texture: number;
  /** Sheet grid texture pixels per cell. */
  paperCell: number;
  /** Ink-pin cylinder segments. */
  dotSegments: number;
  bloomRes: number;
  /** Confetti chips and dust motes. */
  particles: number;
  dust: number;
}
export interface Look {
  preset: Preset;
  /** Key-light shadow map (0 = off). */
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
  grade: boolean;
  antialias: AntialiasMode;
  /** Room-environment reflections. */
  reflections: boolean;
  /** Wood-grain and paper-fibre relief, lacquered pins and strips. */
  detailed: boolean;
  /** Burst and confetti budget: 80 (low) or 300 (high). */
  particles: "low" | "high";
  /** Dust motes and the seat token's pulse. */
  animated: boolean;
  budget: Budget;
}

const TABLE: Record<Preset, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "msaa", reflections: false, detailed: false, particles: "low", animated: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", reflections: true, detailed: true, particles: "high", animated: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, detailed: true, particles: "high", animated: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, detailed: true, particles: "high", animated: true },
};
const BUDGETS: Record<Preset, Budget> = {
  low: { material: "lambert", texture: 256, paperCell: 32, dotSegments: 8, bloomRes: 0.5, particles: 40, dust: 12 },
  balanced: { material: "standard", texture: 512, paperCell: 48, dotSegments: 12, bloomRes: 0.5, particles: 90, dust: 24 },
  high: { material: "physical", texture: 1024, paperCell: 64, dotSegments: 16, bloomRes: 0.5, particles: 160, dust: 36 },
  ultra: { material: "physical", texture: 2048, paperCell: 96, dotSegments: 24, bloomRes: 1, particles: 220, dust: 48 },
};
/** The first level index of each tier (quantum, molecular, terrestrial, galactic). */
const TIER_FLOOR: Record<Preset, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };
export const MAX_PARTICLES = 260;
export const MAX_DUST = 48;

/** The look for a quality tier at a level index (0 quantum … 9 infinite). */
export function lookFor(preset: Preset, levelIndex: number): Look {
  const b = { ...BUDGETS[preset] };
  // Levels are about 1.64× apart in GPU throughput: the counts grow with the
  // level above the tier's first, at most 4× the tier's budget.
  const k = Math.min(4, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.particles = Math.min(MAX_PARTICLES, Math.round(b.particles * k));
  b.dust = Math.min(MAX_DUST, Math.round(b.dust * k));
  return { preset, ...TABLE[preset], budget: b };
}
