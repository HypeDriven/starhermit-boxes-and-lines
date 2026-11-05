// The look per graphics level. The engine-owned effects (shadows and their
// map size, ambient occlusion, bloom, the grade, anti-aliasing) are the
// level's own (levelSettings(): the same table every StarHermit game reads).
// The game's art (materials, textures, segments, reflections, detail,
// motion) is the browser build's four presets (js/gfx.js before the port:
// TABLE and BUDGETS) keyed by the level's quality tier, with the confetti
// and dust-mote budgets scaled within the tier by the level's particle
// budget against the tier's anchor level (quantum, molecular, terrestrial,
// galactic), at most 4×, capped at the 260-chip / 48-mote pools. The
// runtime owns what the old Graphics panel did besides: Auto and the level
// choice, render scale and the pixel-ratio cap, adaptive resolution and the
// frame-rate limit and readout.
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
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
  /** Confetti chips and dust motes. */
  particles: number;
  dust: number;
}
export interface Look {
  preset: Preset;
  /** The level's key-light shadow map size, 0 when the level draws no shadows. */
  shadows: number;
  /** The level's ambient occlusion (null: off). */
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution as a fraction of the frame (null: off). */
  bloom: number | null;
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

type Art = Pick<Look, "reflections" | "detailed" | "particles" | "animated">;
const ART: Record<Preset, Art> = {
  low: { reflections: false, detailed: false, particles: "low", animated: false },
  balanced: { reflections: true, detailed: true, particles: "high", animated: true },
  high: { reflections: true, detailed: true, particles: "high", animated: true },
  ultra: { reflections: true, detailed: true, particles: "high", animated: true },
};
const BUDGETS: Record<Preset, Budget> = {
  low: { material: "lambert", texture: 256, paperCell: 32, dotSegments: 8, particles: 40, dust: 12 },
  balanced: { material: "standard", texture: 512, paperCell: 48, dotSegments: 12, particles: 90, dust: 24 },
  high: { material: "physical", texture: 1024, paperCell: 64, dotSegments: 16, particles: 160, dust: 36 },
  ultra: { material: "physical", texture: 2048, paperCell: 96, dotSegments: 24, particles: 220, dust: 48 },
};
/** Each tier's reference level: its budgets are tuned there. */
const ANCHOR: Record<Preset, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };
export const MAX_PARTICLES = 260;
export const MAX_DUST = 48;

/** The look for a graphics level (the frame's by default). */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  // The counts grow with the level's particle budget above the tier's
  // anchor, at most 4× the tier's budget.
  const k = Math.min(4, s.particles / levelSettings(ANCHOR[preset]).particles);
  const b = BUDGETS[preset];
  return {
    preset, ...ART[preset],
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
    budget: {
      ...b, texture: Math.min(b.texture, s.maxTextureSize),
      particles: Math.min(MAX_PARTICLES, Math.round(b.particles * k)), dust: Math.min(MAX_DUST, Math.round(b.dust * k)),
    },
  };
}
