// Boxes & Lines on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules, content, session and save document are
// the browser build's unchanged js/*.js (classic.ts); this module is what
// js/main.js did around them — the sheet in play (validated commands, undo
// checkpoints, hints, the clock and time limit), the AI's pacing, lessons,
// terminal → stars, bests, stats, achievements and the local and platform
// leaderboards, the screen state machine (title ⇄ mode screens → sheet ⇄
// paused → results), input routing (actions for keys and pads, scene taps
// and hovers, the button board) and the lifecycle — with the screens, HUD and
// button board drawn by screens.ts (starhermit:ui) and the desk by
// render.ts (starhermit:scene).
//
// Time is the runtime's fixed steps (60 a second): the AI replies 27 steps
// (450 ms) after the state changes and the session clock ticks every 15
// steps (250 ms), only while the sheet is active and unpaused, so a pause, a
// hidden window or a slow frame never moves them.
import { frame, onFixedUpdate, onPreferencesChange, onQuit, onRender, onResume, onStart, onSuspend, onUpdate, preferences, setFixedRate } from "starhermit:engine";
import { bindingLabel, onAction, onPointerButton, onPointerMove, onTouch, vibrate } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onPlayerChange, onSessionEnded } from "starhermit:platform";
import { Content, Rules, Session, Store, type Breakdown, type Cfg, type Edge, type GameEvent, type Lesson, type Session as Sess, type Theme } from "./classic.ts";
import * as audio from "./audio.ts";
import { T, onLocaleChange } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens, loadArt } from "./screens.ts";
import { applyPalette, initStyles } from "./style.ts";

const AI_STEPS = 27; // 450 ms
const TICK_STEPS = 15; // 250 ms

export type ScreenName = "title" | "practice" | "journey" | "challenge" | "learn" | "settings" | "help" | "profile" | "scores" | "results";
export interface ResultsView {
  headline: string; sub: () => string; won: boolean; breakdown: Breakdown; stars: number | null;
  achievements: { key: string; name: string; desc: string }[]; canNext: boolean;
  lb: { posted: boolean; rank: number | null } | null; posting: boolean; lesson: boolean;
}
export interface Game {
  sess: Sess; cfg: Cfg; lesson: Lesson | null; lessonCount: number; lessonDone: boolean;
  chainNow: number; bestChain: number; cmdCounter: number;
  aiIn: number; tickIn: number; lastTickSecond: number; lastAnnounced: number;
  finished: boolean;
}

export const app = {
  /** The open dialog screen; null while playing (the HUD shows). */
  screen: "title" as ScreenName | null,
  /** The pause dialog (under a screen opened from it). */
  paused: false,
  /** Frame the screen opened on (the action that opened it must not also close it). */
  openedFrame: 0,
  focusNext: false,
  toast: null as { text: () => string; until: number } | null,
  caption: null as { text: string; until: number } | null,
  results: null as ResultsView | null,
  /** The sheet results' Retry / Next replay (cfg, lesson). */
  last: null as { cfg: Cfg; lesson: Lesson | null } | null,
  scoresTab: "Global" as "Global" | "Platform",
  practicePreset: 0,
  practiceAi: "medium",
  /** The HUD sub-line while an edge is hovered or armed (its consequence). */
  hoverSub: null as string | null,
  hover: null as Edge | null,
  armed: null as Edge | null,
  /** The keyboard / pad focus ring. */
  focus: null as Edge | null,
  hinted: null as { edge: Edge; until: number } | null,
  signedOut: false,
};
export let game: Game | null = null;
export const settings = platform.settings;
const now = (): number => frame().time;

// ------------------------------------------------------------------ helpers
export function fmtTime(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return "";
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}
export const starsText = (n: number): string => "★".repeat(n) + "☆".repeat(3 - n);
export function playerName(p: { type: string; name: string } | undefined): string { return p && p.type === "human" ? T("You") : p ? p.name : ""; }
export function levelName(cfg: Cfg): string { return cfg.kind === "daily" ? T("Daily Sheet — {date}", { date: cfg.date ?? "" }) : T(cfg.name); }
export function goalText(cfg: Cfg): string {
  if (cfg.kind === "journey" && cfg.mastery) return T("Win by {n}+ boxes", { n: cfg.starMargin ?? 1 });
  return T(cfg.goalText || "Claim the most boxes");
}
export function edgeLabel(e: Edge): string {
  return T(e.dir === "h" ? "horizontal edge row {r} column {c}" : "vertical edge row {r} column {c}", { r: e.r + 1, c: e.c + 1 });
}
export const sameEdge = (a: Edge | null, b: Edge | null): boolean => !!a && !!b && a.dir === b.dir && a.r === b.r && a.c === b.c;
const INVALID_TEXT: Record<string, string> = {};
INVALID_TEXT[Rules.INVALID.ENDED!] = "The sheet is already finished.";
INVALID_TEXT[Rules.INVALID.DRAWN!] = "That line is already drawn.";
INVALID_TEXT[Rules.INVALID.BOUNDS!] = "That edge is off the sheet.";
INVALID_TEXT[Rules.INVALID.BAD_CMD!] = "Unknown action.";
INVALID_TEXT[Rules.INVALID.BAD_SHAPE!] = "Malformed action.";
INVALID_TEXT[Rules.INVALID.WRONG_PLAYER!] = "Not your turn.";
function invalidText(reason: string | undefined): string { return T(INVALID_TEXT[reason ?? ""] ?? "That move is not allowed."); }
export const utcDate = (): string => Content.utcDateString(Date.now());
export function dailyCountdown(): string {
  const d = new Date(Date.now());
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  const ms = Math.max(0, next - d.getTime());
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return T("resets in {time}", { time: h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0") });
}
export function totalStars(): number {
  const js = platform.progress().journeyStars;
  return Object.keys(js).reduce((n, k) => n + (js[k] || 0), 0);
}
export function displayName(): string { return platform.displayName() || platform.data.profileName || T("Guest"); }

/** A key's name as the Help card shows it (arrows as arrows). */
function keyName(action: string): string {
  const names: Record<string, string> = { "Arrow Left": "←", "Arrow Right": "→", "Arrow Up": "↑", "Arrow Down": "↓", Escape: "Esc" };
  const raw = bindingLabel(action, "keyboard");
  return names[raw] ?? raw;
}
export function keysText(): string {
  return T("{left} {right} {up} {down} move the focus, {draw} draws, {undo} undo (practice), {hint} hint, {pause} pause, {skip} skip animation, {camera} reset camera", {
    left: keyName("left"), right: keyName("right"), up: keyName("up"), down: keyName("down"), draw: keyName("draw"),
    undo: keyName("undo"), hint: keyName("hint"), pause: keyName("pause"), skip: keyName("skip"), camera: keyName("camera"),
  });
}

export function announce(msg: string): void { if (msg) ui.announce(msg.slice(0, 500)); }
/** `text` is a function so a visible toast follows a language change. */
export function toast(text: string | (() => string), ms = 3000): void {
  app.toast = { text: typeof text === "function" ? text : () => text, until: now() + ms / 1000 };
}
audio.setOnCaption((k) => { if (settings.captions) app.caption = { text: T(k), until: now() + 1.5 }; });

export function playerColors(n = 4): number[] {
  const hv = settings.colorPalette === "high-visibility";
  return Content.PLAYER_STYLES.slice(0, n).map((s) => (hv ? s.colorHC : s.color));
}
export function themeFor(cfg: Cfg | null): Theme {
  const stars = totalStars();
  const pick = (id: string | undefined): Theme | null => {
    const t = Content.THEMES.find((x) => x.id === id);
    return t && stars >= t.unlockStars ? t : null;
  };
  return (cfg && pick(cfg.theme)) || pick(settings.theme) || Content.THEMES[0]!;
}
function applyTheme(): void {
  render.setPalette(themeFor(game ? game.cfg : null).palette, playerColors(4));
}

// ------------------------------------------------------------------ screens
/** A sheet the player can still return to (results do not count). */
export const inPlay = (): boolean => !!game && !game.finished;
export function showScreen(name: ScreenName | null): void {
  app.screen = name;
  app.openedFrame = frame().frame;
  app.focusNext = !!name;
  if (name) audio.play("page");
  else ui.setFocus(null);
}
export function closeScreen(): void {
  app.screen = null;
  app.openedFrame = frame().frame;
  app.focusNext = app.paused;
  ui.setFocus(null);
}
/** Whether the screen's ← Back (and Escape) exists: hidden on the title with no sheet in play. */
export const canGoBack = (): boolean => !!app.screen && !(app.screen === "title" && !inPlay());
/** The ← Back affordance, shared by the button and Escape. */
export function screenBack(): void {
  if (!canGoBack()) return;
  if (app.paused) { closeScreen(); return; } // back to the pause dialog
  if (app.screen === "title") { if (inPlay()) closeScreen(); return; }
  if (!inPlay()) teardownGame(); // leaving a finished sheet for good
  showScreen("title");
}
export function goTitle(): void { teardownGame(); showScreen("title"); }

// ------------------------------------------------------------------ the sheet
export function startGame(cfg: Cfg, lesson: Lesson | null = null): void {
  const sess = Session.create(cfg, cfg.kind);
  if (lesson) Content.applyLessonFixture(sess.state, lesson, Rules);
  game = {
    sess, cfg: sess.cfg, lesson, lessonCount: 0, lessonDone: false, chainNow: 0, bestChain: 0, cmdCounter: 0,
    aiIn: -1, tickIn: TICK_STEPS, lastTickSecond: -1, lastAnnounced: -1, finished: false,
  };
  app.paused = false;
  app.results = null;
  app.armed = app.focus = app.hover = null;
  app.hoverSub = null;
  app.hinted = null;
  closeScreen();
  audio.start();
  audio.setPaused(false);
  const st = sess.state;
  render.setSeats(st.players.length);
  render.setPalette(themeFor(game.cfg).palette, playerColors(4));
  render.setBoard(st.rows, st.cols, st.holes);
  render.syncState(st);
  render.setPreview(null, null);
  render.setFocusEdge(null);
  render.resetCamera();
  announce(cfgName() + ". " + objectiveText());
  const intro = game.cfg.intro;
  if (intro) toast(() => T(intro));
  hudChanged();
  scheduleAi();
}
export function teardownGame(): void {
  game = null;
  app.paused = false;
  app.armed = app.focus = app.hover = null;
  app.hoverSub = null;
  render.setPreview(null, null);
  render.setFocusEdge(null);
  applyTheme();
  render.showDemo();
}
export function cfgName(): string {
  const g = game!;
  return g.lesson ? T(g.lesson.title) : levelName(g.cfg);
}
export function objectiveText(): string {
  const g = game;
  if (!g) return "";
  if (g.lesson) return T(g.lesson.text);
  if (g.cfg.goalText || !g.cfg.intro) return goalText(g.cfg);
  return T(g.cfg.intro);
}
export const isHumanTurn = (): boolean => !!game && Session.isHumanTurn(game.sess);
const pName = (i: number): string => playerName(game!.sess.state.players[i]);
/** The HUD's sub-line: lesson progress, whose turn, or the hovered edge's consequence. */
export function subLine(): string {
  const g = game;
  if (!g) return "";
  if (app.hoverSub) return app.hoverSub;
  const st = g.sess.state;
  if (g.lesson) return g.lesson.goal.count > 1 ? T("Progress: {n} / {total}", { n: Math.min(g.lessonCount, g.lesson.goal.count), total: g.lesson.goal.count }) : "";
  if (isHumanTurn()) return T("Your turn — pick an edge");
  if (!st.over) return T("{name} is drawing…", { name: pName(st.current) });
  return "";
}
export function turnText(): string {
  const st = game!.sess.state;
  return st.over ? T("Sheet complete") : isHumanTurn() ? T("Your turn") : T("{name}’s turn", { name: pName(st.current) });
}
/** Turn announcements (the browser build's updateHUD side effect). */
function hudChanged(): void {
  const g = game!;
  const st = g.sess.state;
  if (st.current !== g.lastAnnounced && !st.over) {
    g.lastAnnounced = st.current;
    announce(isHumanTurn() ? T("Your turn") : T("{name}’s turn", { name: pName(st.current) }));
  }
}

function handleEvents(events: readonly GameEvent[] | undefined): void {
  const g = game!;
  for (const ev of events ?? []) {
    switch (ev.type) {
      case "draw": audio.play(ev.gives ? "danger" : "draw"); break;
      case "box":
        audio.play(ev.player === 0 ? "box" : "box-rival");
        if (ev.player === 0) {
          g.chainNow++;
          if (g.chainNow === 3) audio.play("chain");
          if (g.chainNow > g.bestChain) g.bestChain = g.chainNow;
          if (settings.haptics) vibrate(15);
        }
        break;
      case "pass": g.chainNow = 0; break;
      case "extra-turn": audio.play("extra"); break;
    }
    const l = g.lesson;
    if (l && !g.lessonDone) {
      const goal = l.goal;
      const match = goal.event === "draw-safe" ? ev.type === "draw" && ev.gives === false
        : goal.event === ev.type;
      if (match && ++g.lessonCount >= goal.count) {
        g.lessonDone = true;
        platform.progress().tutorialDone[l.id] = true;
        platform.persist();
      }
    }
  }
}
function afterStateChange(): void {
  const g = game!;
  app.armed = null;
  app.hoverSub = null;
  render.syncState(g.sess.state);
  hudChanged();
  if (g.sess.state.over) { finishGame(); return; }
  if (g.lesson && g.lessonDone) { finishLesson(); return; }
  scheduleAi();
}
const running = (): boolean => !!game && !game.finished && !app.paused && !app.screen;
function scheduleAi(): void {
  const g = game!;
  g.aiIn = !g.sess.state.over && g.sess.state.players[g.sess.state.current]!.type === "ai" ? AI_STEPS : -1;
}
function runAi(): void {
  const res = Session.aiStep(game!.sess);
  if (res && res.ok) {
    handleEvents(res.events);
    render.animateEvents(res.events);
    afterStateChange();
  }
}

// ------------------------------------------------------------------ human input
export function onPick(e: Edge): void {
  const g = game;
  if (!g || !running()) return;
  if (!isHumanTurn()) { audio.play("invalid"); return; }
  // Rejected up front so "confirm moves" never asks to confirm a line that cannot be drawn.
  const bad = Rules.checkDraw(g.sess.state, e.dir, e.r, e.c);
  if (bad) {
    app.armed = null;
    render.setPreview(null, null);
    audio.play("invalid");
    const msg = invalidText(bad);
    toast(msg);
    announce(msg);
    return;
  }
  if (settings.confirmMoves) {
    if (sameEdge(app.armed, e)) commitDraw(e);
    else {
      app.armed = e;
      const kind = previewKind(e);
      render.setPreview(e, kind);
      app.hoverSub = consequence(kind);
      toast(() => T("Tap again to confirm"));
    }
    return;
  }
  commitDraw(e);
}
function previewKind(e: Edge): "ok" | "risky" | "claim" {
  const pv = Rules.previewDraw(game!.sess.state, e.dir, e.r, e.c);
  return pv.claims.length ? "claim" : pv.gives ? "risky" : "ok";
}
function consequence(kind: "ok" | "risky" | "claim"): string {
  return T(kind === "claim" ? "Claims a box — draw again!" : kind === "risky" ? "Risky: gives away a box" : "Safe line");
}
function commitDraw(e: Edge): void {
  const g = game!;
  if (g.sess.state.over) return;
  g.aiIn = -1;
  Session.checkpoint(g.sess);
  const res = Session.apply(g.sess, { id: "c" + (++g.cmdCounter), type: "draw", dir: e.dir, r: e.r, c: e.c, player: g.sess.state.current });
  if (!res.ok) {
    audio.play("invalid");
    const msg = invalidText(res.reason);
    toast(msg);
    announce(msg);
    return;
  }
  handleEvents(res.events);
  render.animateEvents(res.events);
  render.setPreview(null, null);
  app.hover = null;
  afterStateChange();
}
/** Pointer hover over an edge (null: off the sheet). */
export function onHover(e: Edge | null): void {
  const g = game;
  if (sameEdge(e, app.hover) || (!e && !app.hover)) return;
  app.hover = e;
  if (!g || !running() || !isHumanTurn() || app.armed) return;
  if (!e || Rules.checkDraw(g.sess.state, e.dir, e.r, e.c)) { render.setPreview(null, null); app.hoverSub = null; return; }
  const kind = previewKind(e);
  render.setPreview(e, kind);
  app.hoverSub = consequence(kind);
}
export function doUndo(): void {
  const g = game;
  if (!g || !running() || !Session.canUndo(g.sess)) return;
  g.aiIn = -1;
  if (Session.undo(g.sess)) {
    app.armed = null;
    app.hoverSub = null;
    audio.play("undo");
    render.syncState(g.sess.state);
    render.setPreview(null, null);
    announce(T("Move undone. Your turn."));
  }
}
export function doHint(): void {
  const g = game;
  if (!g || !running() || !g.cfg.mechanics.hint || !isHumanTurn()) return;
  const m = Session.hint(g.sess);
  if (!m) return;
  app.focus = m;
  render.setFocusEdge(m);
  app.hinted = { edge: m, until: now() + 1.6 };
  audio.play("hint");
  announce(T("Hint: try the {edge}", { edge: edgeLabel(m) }));
}
export const canHint = (): boolean => !!game && !!game.cfg.mechanics.hint && isHumanTurn() && !game.finished;
export const canUndo = (): boolean => !!game && Session.canUndo(game.sess) && !game.finished;
export function doSkip(): void {
  render.skipAnimations();
  audio.play("ui");
  announce(T("Animations skipped"));
}
function setFocusEdge(e: Edge | null): void {
  app.focus = e;
  render.setFocusEdge(e);
  if (e) announce(edgeLabel(e));
}
const edgeXY = (e: Edge): { x: number; y: number } => (e.dir === "h" ? { x: e.c + 0.5, y: e.r } : { x: e.c, y: e.r + 0.5 });
function moveFocus(dx: number, dy: number): void {
  const legal = Rules.legalActions(game!.sess.state);
  if (!legal.length) return;
  if (!app.focus) { setFocusEdge(legal[0]!); return; }
  const cur = edgeXY(app.focus);
  let best: Edge | null = null, bestScore = Infinity;
  for (const e of legal) {
    const p = edgeXY(e);
    const ddx = p.x - cur.x, ddy = p.y - cur.y;
    const primary = dx ? ddx * dx : ddy * dy;
    if (primary <= 0.01) continue;
    const score = primary + (dx ? Math.abs(ddy) : Math.abs(ddx)) * 3;
    if (score < bestScore) { bestScore = score; best = e; }
  }
  if (best) setFocusEdge(best);
}

// ------------------------------------------------------------------ pause
export function pauseGame(): void {
  if (!game || !running()) return;
  app.paused = true;
  app.openedFrame = frame().frame;
  app.focusNext = true;
  audio.setPaused(true);
  audio.play("pause");
  announce(T("Paused"));
}
export function resumeGame(): void {
  if (!app.paused) return;
  app.paused = false;
  app.screen = null;
  ui.setFocus(null);
  audio.setPaused(false);
  announce(T("Resumed.") + (isHumanTurn() ? " " + T("Your turn.") : ""));
}
export function leaveSheet(): void { app.screen = null; goTitle(); }

// ------------------------------------------------------------------ the end of a sheet
function finishLesson(): void {
  const g = game!, l = g.lesson!;
  g.finished = true;
  g.sess.active = false;
  audio.play("win");
  announce(T("Lesson complete: {name}", { name: T(l.title) }));
  const lessons = Content.tutorialLessons();
  const idx = lessons.findIndex((x) => x.id === l.id);
  app.last = { cfg: g.cfg, lesson: l };
  const title = l.title;
  app.results = {
    headline: "Lesson complete", sub: () => T(title), won: true, breakdown: { components: [], total: 0, won: true }, stars: null,
    achievements: [], canNext: idx >= 0 && idx + 1 < lessons.length, lb: null, posting: false, lesson: true,
  };
  showScreen("results");
}
function finishGame(): void {
  const g = game!;
  if (g.lesson && g.lessonDone) { finishLesson(); return; }
  g.finished = true;
  const st = g.sess.state, cfg = g.cfg, sess = g.sess;
  const out = Rules.outcome(st);
  audio.play(out.draw ? "drawn-game" : out.winner === 0 ? "win" : "lose");
  const players = st.players.slice(), scores = st.scores.slice();
  const scoreLine = (): string => players.map((p, i) => playerName(p) + " " + scores[i]).join(" · ");
  announce(T(out.draw ? "A tie." : out.winner === 0 ? "Victory!" : "Defeat.") + " " + scoreLine());
  const breakdown = Rules.scoreBreakdown(st, 0, sess.elapsedMs);
  const won = out.winner === 0;
  const p = platform.progress(), stt = p.stats;
  stt.rounds += 1;
  if (won) stt.wins += 1;
  stt.boxesClaimed += st.scores[0]!;
  if (g.bestChain > stt.bestChain) stt.bestChain = g.bestChain;
  stt.playMs += sess.elapsedMs;
  let stars: number | null = null;
  if (cfg.kind === "journey" && won) {
    const margin = st.scores[0]! - Math.max(0, ...st.scores.filter((_, i) => i !== 0));
    stars = 1 + (margin >= (cfg.starMargin || 1) ? 1 : 0) + (cfg.par && sess.elapsedMs <= cfg.par.timeSec * 1000 ? 1 : 0);
    p.journeyStars[cfg.id] = Math.max(p.journeyStars[cfg.id] || 0, stars);
    p.journeyBest[cfg.id] = Math.max(p.journeyBest[cfg.id] || 0, breakdown.total);
  } else if (cfg.kind === "challenge" && won) {
    p.challengeBest[cfg.id] = Math.max(p.challengeBest[cfg.id] || 0, breakdown.total);
  } else if (cfg.kind === "daily") {
    const date = cfg.date || utcDate();
    p.dailiesDone[date] = Math.max(p.dailiesDone[date] || 0, breakdown.total);
    const yStr = Content.utcDateString(new Date(date + "T00:00:00Z").getTime() - 86400000);
    stt.dailyStreak = p.dailiesDone[yStr] != null ? (stt.lastDaily === date ? stt.dailyStreak : stt.dailyStreak + 1) : 1;
    stt.lastDaily = date;
  }
  const unlocked: { key: string; name: string; desc: string }[] = [];
  const unlock = (key: string): void => {
    if (p.achievements[key]) return;
    p.achievements[key] = Date.now();
    const meta = Store.ACHIEVEMENTS.find((a) => a.key === key);
    if (meta) { unlocked.push(meta); toast(() => "★ " + T(meta.name)); audio.play("star"); }
  };
  if (stt.boxesClaimed > 0) unlock("first-box");
  if (stt.wins > 0) unlock("first-win");
  if (stt.bestChain >= 3) unlock("chain-3");
  if (Object.keys(p.journeyStars).filter((k) => p.journeyStars[k]! > 0).length >= 10) unlock("journey-10");
  if (stt.dailyStreak >= 3 || Object.keys(p.dailiesDone).length >= 3) unlock("daily-3");
  if (stt.boxesClaimed >= 500) unlock("boxes-500");

  const ranked = !!(cfg.ranked && !sess.assists);
  if (ranked) {
    const boards = Store.loadBoards();
    boards.entries = Store.sortEntries(boards.entries.concat([{
      name: displayName(), playerId: platform.userId() ?? undefined, score: breakdown.total, board: cfg.id, seed: cfg.seed,
      ruleset: cfg.kind, contentVersion: cfg.version, assists: sess.assists, durationMs: sess.elapsedMs, invalid: sess.invalid[0] || 0,
      sessionId: (Math.random().toString(16) + "0000000000").slice(2, 18), at: Date.now(),
    }])).slice(0, 100);
    Store.saveBoards(boards);
  }
  platform.persist();
  app.last = { cfg, lesson: null };
  const next = cfg.kind === "journey" ? Content.JOURNEY[(cfg.index ?? 0) + 1] : undefined;
  const post = ranked && platform.signedIn();
  const view: ResultsView = {
    headline: out.reason === Rules.TERMINAL.TIME ? "Time!" : out.draw ? "A tie!" : won ? "Victory!" : "Defeat",
    sub: scoreLine, won, breakdown, stars: cfg.kind === "journey" ? (stars || p.journeyStars[cfg.id] || 0) : null,
    achievements: unlocked, canNext: !!(next && won), lb: null, posting: post, lesson: false,
  };
  app.results = view;
  showScreen("results");
  // Signed in, every finished ranked, unassisted sheet goes to the StarHermit high-score board.
  if (post) void platform.postLeaderboard(breakdown.total).then((r) => { view.lb = r; view.posting = false; });
}
export function retry(): void {
  const l = app.last;
  if (l) startGame(l.cfg, l.lesson);
}
export function nextSheet(): void {
  const l = app.last;
  if (l && l.lesson) {
    const lessons = Content.tutorialLessons();
    const idx = lessons.findIndex((x) => x.id === l.lesson!.id);
    if (idx >= 0 && idx + 1 < lessons.length) { startGame(lessons[idx + 1]!.cfg, lessons[idx + 1]!); return; }
    teardownGame();
    showScreen("learn");
    return;
  }
  if (l && l.cfg.kind === "journey") {
    const next = Content.JOURNEY[(l.cfg.index ?? 0) + 1];
    if (next) { startGame(next); return; }
  }
  goTitle();
}
export function startLesson(i: number): void {
  const lesson = Content.tutorialLessons()[i];
  if (lesson) startGame(lesson.cfg, lesson);
}
export function startDaily(): void { startGame(Content.dailyConfig(utcDate())); }
export function startPractice(): void {
  const preset = Content.PRACTICE[app.practicePreset] ?? Content.PRACTICE[0]!;
  startGame(Content.practiceConfig(preset.id, app.practiceAi, (Math.random() * 0xffffffff) >>> 0));
}

// ------------------------------------------------------------------ input
onAction((e) => {
  if (!e.pressed || ui.capturingKeys()) return;
  const a = e.action;
  if (a === "pause") {
    if (frame().frame === app.openedFrame) return;
    if (app.screen) return; // Escape on a screen is its Back (screens.ts, ui.back())
    if (app.paused) resumeGame(); else pauseGame();
    return;
  }
  if (!running() || !isHumanTurn()) return;
  // While a widget has focus (Tab), arrows and Enter are the widgets'; else
  // they are the focus ring's, and the interface must not take them too.
  const widget = !!ui.focused();
  if (!widget && ["left", "right", "up", "down", "first", "last", "draw"].includes(a)) ui.setFocus(null);
  switch (a) {
    case "left": if (!widget) moveFocus(-1, 0); break;
    case "right": if (!widget) moveFocus(1, 0); break;
    case "up": if (!widget) moveFocus(0, -1); break;
    case "down": if (!widget) moveFocus(0, 1); break;
    case "first": case "last": {
      const legal = Rules.legalActions(game!.sess.state);
      if (legal.length) { setFocusEdge(a === "last" ? legal[legal.length - 1]! : legal[0]!); }
      break;
    }
    case "draw": if (!widget && app.focus) onPick(app.focus); break;
    case "cancel": app.armed = null; app.hoverSub = null; render.setPreview(null, null); break;
    case "undo": doUndo(); break;
    case "hint": doHint(); break;
    case "skip": doSkip(); break;
    case "camera": render.resetCamera(); break;
  }
});

// Scene taps draw the edge under them; a drag over 6 px orbits the camera
// slightly and commits nothing. Touch and the mouse can both report one tap:
// a pointer press right after a touch is skipped.
let down: { x: number; y: number; moved: boolean } | null = null;
let lastTouch = -1e9;
const tapDist = (): number => 6 * frame().scale;
function sceneDown(x: number, y: number): void {
  down = game && !ui.pointerOver() ? { x, y, moved: false } : null;
}
function sceneMove(x: number, y: number): void {
  if (down) {
    if (!down.moved && Math.hypot(x - down.x, y - down.y) > tapDist()) down.moved = true;
    if (down.moved) { render.setOrbit((x - down.x) / frame().scale, (y - down.y) / frame().scale); onHover(null); return; }
  }
  onHover(game && !ui.pointerOver() ? render.pick(x, y) : null);
}
function sceneUp(x: number, y: number): void {
  const d = down;
  down = null;
  if (!d || d.moved || !game) return;
  const e = render.pick(x, y);
  if (e) onPick(e);
}
onPointerButton((e) => {
  if (e.button !== 0 || now() - lastTouch < 0.6) return;
  if (e.pressed) sceneDown(e.x, e.y); else sceneUp(e.x, e.y);
});
onPointerMove((x, y) => { if (now() - lastTouch >= 0.6) sceneMove(x, y); });
onTouch((e) => {
  if (!e.primary) return;
  lastTouch = now();
  if (e.phase === "start") sceneDown(e.x, e.y);
  else if (e.phase === "move") { if (down) sceneMove(e.x, e.y); }
  else if (e.phase === "end") { sceneUp(e.x, e.y); onHover(null); }
  else down = null;
});

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const key = `${f.quality}:${f.levelIndex}`;
  if (key === lookKey) return;
  lookKey = key;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}
function applyPrefs(): void {
  const p = preferences();
  render.setReducedMotion(p.reducedMotion);
  applyPalette(p.highContrast, settings.colorPalette === "high-visibility");
}

onStart(() => {
  setFixedRate(60);
  initStyles();
  platform.initPlatform();
  audio.loadSfx();
  applyPrefs();
  applyLook();
  loadArt();
  applyTheme();
  render.showDemo();
  showScreen("title");
});
onPreferencesChange(() => applyPrefs());
onLocaleChange(() => { if (game?.lesson) announce(objectiveText()); });
platform.onSettingsChange(() => { applyPrefs(); applyTheme(); });
platform.onProgressMerged(() => applyTheme());
onSessionEnded(() => { app.signedOut = true; toast(() => T("Signed out of StarHermit — progress stays on this device.")); });
onPlayerChange((p) => { if (p) app.signedOut = false; });
onSuspend(() => {
  // Backgrounding pauses the sheet; nothing is lost.
  if (running()) pauseGame();
  audio.setPaused(true);
  platform.flush();
});
onResume(() => { if (!app.paused && !app.screen) audio.setPaused(false); });
onQuit(() => platform.flush());

onFixedUpdate(() => {
  const g = game;
  if (!g || !running()) return;
  if (g.aiIn > 0 && --g.aiIn === 0) { g.aiIn = -1; runAi(); if (!game || game.finished) return; }
  if (--g.tickIn <= 0) {
    g.tickIn = TICK_STEPS;
    const res = Session.tick(g.sess, 250);
    if (res && res.ok) { handleEvents(res.events); render.animateEvents(res.events); afterStateChange(); return; }
    const limit = g.cfg.timeLimitSec;
    if (limit) {
      const remain = Math.max(0, limit * 1000 - g.sess.elapsedMs), sec = Math.ceil(remain / 1000);
      if (remain > 0 && remain <= 10000 && sec !== g.lastTickSecond) { g.lastTickSecond = sec; audio.play("tick"); }
    }
  }
});
let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  applyLook();
  audio.update();
  const t0 = now();
  if (app.toast && t0 > app.toast.until) app.toast = null;
  if (app.caption && t0 > app.caption.until) app.caption = null;
  if (app.hinted && t0 > app.hinted.until) app.hinted = null;
});
onRender(() => {
  drawScreens();
  render.frame(frameDt);
});
