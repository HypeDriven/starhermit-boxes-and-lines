// The browser build's pure game scripts, unchanged and shared with the Node
// tests: rng, rules, content, session, store and the string tables (js/*.js,
// UMD), plus js/migrate.js (the engine save document and what the browser
// build left in the account), evaluated as classic scripts so their globals
// (BLRNG, BLRules, BLContent, BLSession, BLStore, BLI18N, BLMigrate) are this
// module's exports.
//
// js/store.js keeps the device's local leaderboard in `localStorage`: here
// that is a small shim over the device's starhermit:storage, installed
// before the scripts run. Progress is the game's save (platform.ts).
import { storage } from "starhermit:storage";
import { loadClassic } from "starhermit:script";

const shim = {
  getItem(key: string): string | null {
    try { return storage.getText(key); } catch { return null; }
  },
  setItem(key: string, value: string): void {
    try { storage.set(key, String(value)); } catch (e) { console.warn(`storage ${key}: ${String(e)}`); }
  },
  removeItem(key: string): void {
    try { storage.remove(key); } catch { /* gone */ }
  },
};
(globalThis as unknown as { localStorage: typeof shim }).localStorage = shim;

for (const f of ["js/rng.js", "js/rules.js", "js/content.js", "js/session.js", "js/store.js", "js/strings.js", "js/i18n.js", "js/migrate.js"]) loadClassic(f);

// -- The shapes this client reads -------------------------------------------------
export type Dir = "h" | "v";
export interface Edge { dir: Dir; r: number; c: number }
export interface Player { name: string; type: "human" | "ai"; ai: string }
export interface Palette { desk: number; deskDark: number; paper: number; grid: number; dot: number; wall: number; light: number; fog: number }
export interface Theme { id: string; name: string; unlockStars: number; palette: Palette }
export interface Cfg {
  id: string; version: number; kind: string; name: string; index?: number; seed: number; rows: number; cols: number;
  players: Player[]; prefill?: number; timeLimitSec?: number; par?: { timeSec: number }; starMargin?: number; mastery?: boolean;
  theme?: string; intro?: string; goalText?: string; mechanics: { undo: boolean; hint: boolean }; ranked?: boolean; date?: string;
  goal?: { type: string; target: number }; startPlayer?: number;
}
export interface GameEvent { type: string; dir?: Dir; r?: number; c?: number; player?: number; gives?: boolean; claims?: number; winner?: number; to?: number; total?: number }
export interface State {
  v: number; cfg: Cfg; rows: number; cols: number; holes: Record<string, boolean>;
  he: number[][]; ve: number[][]; cells: number[][]; players: Player[]; current: number;
  scores: number[]; moves: number[]; turn: number; boxesLeft: number; over: boolean; winner: number; reason: string | null;
  rng: number; events: GameEvent[];
}
export interface Result { ok: boolean; reason?: string; events?: GameEvent[] }
export interface Session {
  cfg: Cfg; mode: string; state: State; log: unknown[]; undoStack: unknown[]; invalid: number[];
  hintsUsed: number; assists: boolean; elapsedMs: number; active: boolean; lastCmdId: string | null;
}
export interface Breakdown { components: { key: string; label: string; points: number }[]; total: number; won: boolean }
export interface Lesson { id: string; title: string; text: string; theme: string; cfg: Cfg; goal: { event: string; count: number } }
export interface Progress {
  tutorialDone: Record<string, boolean>; journeyStars: Record<string, number>; journeyBest: Record<string, number>;
  challengeBest: Record<string, number>; dailiesDone: Record<string, number>; achievements: Record<string, number>;
  stats: { rounds: number; wins: number; boxesClaimed: number; bestChain: number; playMs: number; dailyStreak: number; lastDaily: string };
  cosmetics?: { theme: string };
}
export interface Settings {
  captions: boolean; theme: string; colorPalette: string; leftHanded: boolean; haptics: boolean; boardMirror: boolean; confirmMoves: boolean;
  [key: string]: unknown;
}
export interface SaveData { progress: Progress; profileName: string }
export interface BoardEntry { name: string; playerId?: string; score: number; board: string; durationMs?: number; invalid?: number; sessionId: string; at?: number; [k: string]: unknown }

interface RulesApi {
  TERMINAL: Record<string, string>; INVALID: Record<string, string>;
  legalActions(s: State): Edge[];
  checkDraw(s: State, dir: Dir, r: number, c: number): string | null;
  previewDraw(s: State, dir: Dir, r: number, c: number): { claims: [number, number][]; gives: boolean };
  outcome(s: State): { over: boolean; winner: number; draw: boolean; reason: string | null; scores: number[] };
  scoreBreakdown(s: State, p: number, elapsedMs: number): Breakdown;
}
interface ContentApi {
  CONTENT_VERSION: number;
  PLAYER_STYLES: { name: string; icon: string; shape: string; color: number; colorHC: number; css: string }[];
  AI_NAMES: Record<string, string>; AI_LEVELS: string[]; THEMES: Theme[];
  JOURNEY: Cfg[]; CHALLENGES: Cfg[]; PRACTICE: Cfg[];
  practiceConfig(presetId: string, ai: string, seed: number): Cfg;
  dailyConfig(date: string): Cfg;
  utcDateString(ms?: number): string;
  tutorialLessons(): Lesson[];
  applyLessonFixture(s: State, l: Lesson, rules: unknown): void;
}
interface SessionApi {
  create(cfg: Cfg, mode?: string): Session;
  isHumanTurn(s: Session): boolean;
  apply(s: Session, cmd: Record<string, unknown>): Result;
  checkpoint(s: Session): void;
  canUndo(s: Session): boolean;
  undo(s: Session): boolean;
  hint(s: Session): Edge | null;
  aiStep(s: Session): Result | null;
  tick(s: Session, ms: number): Result | null;
}
interface StoreApi {
  DEFAULT_SETTINGS: Settings;
  ACHIEVEMENTS: { key: string; name: string; desc: string }[];
  fresh(): { v: number; settings: Settings; progress: Progress };
  loadBoards(): { entries: BoardEntry[] };
  saveBoards(b: { entries: BoardEntry[] }): void;
  sortEntries(e: BoardEntry[]): BoardEntry[];
}
interface RngApi { hashString(s: string): number }
interface I18nApi {
  T(key: string, vars?: Record<string, string | number> | null): string;
  match(tag: string): string;
  setLocale(tag: string): string;
  LOCALES: string[];
  readonly lang: string;
}
interface MigrateApi {
  GAME_SETTING_KEYS: string[];
  BROWSER_SETTING_KEYS: string[];
  fromSave(doc: unknown): SaveData | null;
  docFromBrowserSave(text: string | null): { settings: Record<string, unknown>; progress: Progress; profileName?: string } | null;
  saveDoc(data: SaveData): unknown;
  merge(remote: SaveData | null, local: SaveData | null): SaveData;
  migrateSetting(key: string, value: unknown): unknown;
}

const g = globalThis as unknown as {
  BLRules: RulesApi; BLContent: ContentApi; BLSession: SessionApi; BLStore: StoreApi; BLRNG: RngApi; BLI18N: I18nApi; BLMigrate: MigrateApi;
};
export const Rules = g.BLRules;
export const Content = g.BLContent;
export const Session = g.BLSession;
export const Store = g.BLStore;
export const RNG = g.BLRNG;
export const I18n = g.BLI18N;
export const Migrate = g.BLMigrate;
