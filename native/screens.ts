// The browser build's DOM shell (js/main.js buildShell, js/ui.js and
// css/style.css) as starhermit:ui, built every frame: the HUD (the objective
// block, the status block with the turn indicator, the players' score chips
// and the clock, the Hint · Undo · Skip · Pause block), the button board (a
// spatial grid of dots, edge buttons and box cells mirroring the sheet; every
// edge is a button), the toast and the caption line, the pause dialog, and
// the dialog screens (title over its key art, Practice, Journey, Challenge,
// Learn, Results, Settings, Help, Profile, Scores) in one paper panel with a
// ← Back header. The browser's media queries are layouts picked by the
// window's logical size: desktop (≥ 1024 px: the three HUD blocks in a row),
// compact (the objective on its own row above status and actions), portrait
// phone (≤ 700 px: status over objective, the actions a thumb tray at the
// bottom) and short landscape (≤ 500 px tall: one HUD row without the
// sub-line, the button board a compact panel beside the scene). The desk is
// framed into the space the HUD and the board leave (render.setPlayfield).
import { clipboard, frame, openMenu } from "starhermit:engine";
import * as ui from "starhermit:ui";
import { requestSignIn } from "starhermit:platform";
import { TextureLoader, type Texture } from "starhermit:scene";
import { Content, Store, type BoardEntry, type Edge } from "./classic.ts";
import { T } from "./i18n.ts";
import * as platform from "./platform.ts";
import * as render from "./render.ts";
import {
  app, canGoBack, canHint, canUndo, dailyCountdown, doHint, doSkip, doUndo, edgeLabel, fmtTime, game, goTitle,
  isHumanTurn, keysText, leaveSheet, nextSheet, objectiveText, onPick, pauseGame, playerName, resumeGame, retry,
  sameEdge, screenBack, settings, showScreen, starsText, startDaily, startGame, startLesson, startPractice, subLine, toast, totalStars,
  turnText, utcDate,
} from "./main.ts";

// ------------------------------------------------------------------ layout
interface Layout { lw: number; lh: number; sc: number; wide: boolean; portrait: boolean; shortLand: boolean; ox: number; oy: number }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  return { lw, lh, sc, wide: lw >= 1024, portrait: lw <= 700 && lh > lw, shortLand: lw > lh && lh <= 500, ox: sa.left, oy: sa.top };
}
const lastSize = new Map<string, { w: number; h: number }>();
const remember = (key: string, r: ui.Rect, sc: number): void => { lastSize.set(key, { w: r.width / sc, h: r.height / sc }); };
const sizeOf = (key: string, w = 0, h = 0): { w: number; h: number } => lastSize.get(key) ?? { w, h };

type Cls = string | ui.Style;
function textWidth(text: string, style: Cls | readonly Cls[], kind?: "button"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style: Array.isArray(style) ? [...style] : [style as Cls] }).width / ui.preferences().scale;
}
const buttonWidth = (text: string, style: readonly Cls[]): number => textWidth(text, style, "button") + 2;

interface Btn { id: string; text: string; style?: Cls[]; disabled?: boolean; selected?: boolean; act: () => void }
const PLAIN: Cls[] = ["btn"];
/** A button `width` wide (null: its text's); a label too long for it wraps inside. */
function button(b: Btn, width: number | null = null): boolean {
  const style = b.style ?? PLAIN;
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  if (b.selected != null) opts.selected = b.selected;
  const s: ui.Style = width != null ? { width } : {};
  if (width != null && buttonWidth(b.text, style) > width) {
    const inner = width - 40;
    opts.content = () => { ui.style({ text: { align: "center" } }).paragraph(b.text, inner); };
  }
  const hit = ui.style(...style, s).id(b.id).button(b.text, opts);
  if (hit) b.act();
  return hit;
}
/** Buttons at their own widths in rows that wrap at `width` (CSS flex-wrap). */
function flow(label: string, list: Btn[], width: number, align: "start" | "center" = "start", gap = 10): void {
  const rows: Btn[][] = [[]];
  let used = 0;
  for (const b of list) {
    const bw = Math.min(width, buttonWidth(b.text, b.style ?? PLAIN));
    if (rows[rows.length - 1]!.length && used + gap + bw > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + bw;
    rows[rows.length - 1]!.push(b);
  }
  ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => {
      for (const b of row) button(b, buttonWidth(b.text, b.style ?? PLAIN) > width ? width : null);
    }, { spacing: gap, align: "center" }));
  }, { spacing: gap, align, width });
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls?: string | null, id?: string, center = false): void {
  if (!text) return;
  const styles: (string | ui.Style)[] = cls ? [cls] : [];
  if (center) styles.push({ text: { align: "center" } });
  let u = ui.style(...styles);
  if (id) u = u.id(id);
  if (ui.measureText(text, { style: styles }).width / ui.preferences().scale <= width) u.label(text);
  else u.paragraph(text, width);
}
/** Columns of `min` px or more filling `w` (CSS repeat(auto-fit, minmax(min, 1fr))). */
const fitColumns = (w: number, min: number, gap: number): number => Math.max(1, Math.floor((w + gap) / (min + gap)));

// ------------------------------------------------------------------ art
let titleArt: Texture | null = null, winArt: Texture | null = null;
export function loadArt(): void {
  const loader = new TextureLoader();
  // Missing art never breaks a screen: it is left out.
  loader.loadAsync("assets/title-art.webp").then((t) => { titleArt = t; }, () => undefined);
  loader.loadAsync("assets/results-art.webp").then((t) => { winArt = t; }, () => undefined);
}
/** Key art `width` wide at `aspect`, cropped from the picture's centre. A
 * fallback colour shows where the web runtime leaves ui images out over a
 * scene (the bearing-board port's engine report). */
function art(tex: Texture | null, width: number, aspect: number, srcAspect: number): void {
  if (!tex) return;
  const h = Math.round(width / aspect);
  const f = Math.min(1, srcAspect / aspect); // the picture's height share shown
  ui.style("key-art").image("", tex, { width, height: h }, { min: [0, (1 - f) / 2], max: [1, 1 - (1 - f) / 2] });
}

// ------------------------------------------------------------------ the frame
function firstLabel(): string | null {
  if (app.paused && !app.screen) return T("Resume");
  switch (app.screen) {
    case "title": return titleCards()[0]!.label;
    case "practice": return T("Start sheet");
    case "journey": return journeyLabel(0);
    case "challenge": return T(Content.CHALLENGES[0]!.name);
    case "learn": return lessonLabel(0);
    case "results": return "↻ " + T("Retry");
    case "settings": return T("Captions for sound cues");
    case "help": case "profile": case "scores": return T("← Back");
    default: return null;
  }
}

export function drawScreens(): void {
  const L = layoutNow();
  // The screen's first control takes focus; inside a scroll area focus may
  // not take at once, so it is asked again until it holds (≤ 12 frames).
  if (app.focusNext && (app.screen || app.paused)) {
    const since = frame().frame - app.openedFrame;
    const first = firstLabel();
    if (!first || since > 14 || (since > 2 && ui.focused() === first)) app.focusNext = false;
    else if (since >= 2) ui.setFocus(first);
  }
  if (app.screen && ui.back() && frame().frame > app.openedFrame) screenBack();
  if (game) hud(L);
  else render.setPlayfield(0, 0, frame().width, frame().height, frame().width, frame().height);
  if (app.paused && !app.screen) pauseDialog(L);
  if (app.screen) screen(L);
  toastAndCaption(L);
}

// ------------------------------------------------------------------ HUD
const tray = { h: 0 };
function hud(L: Layout): void {
  const g = game!;
  const st = g.sess.state;
  const pad = L.portrait || L.shortLand ? 8 : 10;
  const inner = L.lw - pad * 2;
  const left = !!settings.leftHanded;
  const actions: Btn[] = [
    { id: "btn-hint", text: T("Hint"), style: ["btn", "btn-hud"], disabled: !canHint() || !!app.screen || app.paused, act: doHint },
    { id: "btn-undo", text: T("Undo"), style: ["btn", "btn-hud"], disabled: !canUndo() || !!app.screen || app.paused, act: doUndo },
    { id: "btn-skip", text: T("Skip"), style: ["btn", "btn-hud"], disabled: !!app.screen || app.paused, act: doSkip },
    { id: "btn-pause", text: T("Pause"), style: ["btn", "btn-hud"], disabled: g.finished || !!app.screen || app.paused, act: pauseGame },
  ];
  if (left) actions.reverse();
  const hudBtn = (b: Btn, width: number | null): void => { if (button(b, width)) ui.setFocus(null); };
  const objective = (w: number | null): void => {
    ui.column("hud-objective", () => {
      const tw = (w ?? 400) - 28;
      para(objectiveText(), tw, "hud-title", "objective-text");
      if (!L.shortLand) para(subLine() || " ", tw, "hud-sub", "objective-sub");
    }, { style: "hud-block", spacing: 2, ...(w != null ? { width: w } : {}) });
  };
  const chips = (): void => {
    ui.row("score-strip", () => {
      st.players.forEach((p, i) => {
        const style = Content.PLAYER_STYLES[i % 4]!;
        const active = i === st.current && !st.over;
        ui.row(`chip-${i}`, () => {
          ui.style("chip-name", { text: { color: `$p${i % 4}` } }).label(style.icon);
          ui.style("chip-name").label(playerName(p));
          ui.style("chip-score").id(`chip-${i}-score`).label(String(st.scores[i]));
        }, { style: active ? "chip-active" : "chip", spacing: 6, align: "center" });
      });
    }, { spacing: 6, align: "center" });
  };
  const clockText = (): { text: string; low: boolean } => {
    const limit = g.cfg.timeLimitSec;
    if (!limit) return { text: fmtTime(g.sess.elapsedMs), low: false };
    const remain = Math.max(0, limit * 1000 - g.sess.elapsedMs);
    return { text: fmtTime(remain), low: remain <= 10000 };
  };
  const status = (w: number | null): void => {
    ui.row("hud-status", () => {
      ui.style("turn").id("turn-indicator").label(turnText());
      chips();
      const c = clockText();
      ui.style(c.low ? "clock-low" : "clock").id("clock").label(c.text);
    }, { style: "hud-block", spacing: 14, align: "center", ...(w != null ? { width: w } : {}) });
  };
  const actionRow = (): void => {
    ui.row("hud-actions", () => { for (const b of actions) hudBtn(b, null); }, { style: "hud-block", spacing: 8, align: "center" });
  };
  const actW = actions.reduce((n, b) => n + buttonWidth(b.text, b.style!) + 8, 28 - 8);
  const statusW = sizeOf("status", 300).w;
  let topH: number;
  tray.h = 0;
  const top = ui.place("topbar", { anchor: "top-start", x: pad, y: pad }, () => {
    if (L.portrait) {
      ui.column("top-col", () => {
        status(inner);
        objective(inner);
      }, { spacing: 6, width: inner });
    } else if (L.wide || L.shortLand) {
      ui.row("top-row", () => {
        const objW = Math.max(160, inner - statusW - actW - 20);
        if (!left) { objective(objW); status(null); actionRow(); }
        else { actionRow(); status(null); objective(objW); }
      }, { spacing: L.shortLand ? 6 : 10, width: inner, align: "stretch" });
    } else {
      ui.column("top-col", () => {
        objective(inner);
        ui.row("top-row2", () => {
          if (!left) { status(Math.max(160, inner - actW - 10)); actionRow(); } else { actionRow(); status(Math.max(160, inner - actW - 10)); }
        }, { spacing: 10, width: inner, align: "stretch" });
      }, { spacing: 10, width: inner });
    }
  });
  topH = top.height / L.sc + pad;
  const st0 = lastSize.get("status");
  if (!st0 || L.wide) {
    // the status block's natural width, for the next frame's row
    const chipsW = st.players.reduce((n, p, i) => n + textWidth(Content.PLAYER_STYLES[i % 4]!.icon + "  " + playerName(p) + "  " + st.scores[i], "chip-name") + 30, 0);
    lastSize.set("status", { w: Math.min(inner * 0.5, textWidth(turnText(), "turn") + chipsW + textWidth("00:00", "clock") + 28 + 28), h: 0 });
  }

  // --- portrait: the thumb tray
  if (L.portrait) {
    const tw = inner;
    const bw = Math.floor((tw - 16 - 3 * 8) / 4);
    const h = sizeOf("tray", 0, 64).h;
    const r = ui.place("tray", { anchor: "top-start", x: pad, y: L.lh - pad - h }, () => {
      ui.row("tray-row", () => { for (const b of actions) hudBtn({ ...b, style: ["btn", "btn-hud", { minHeight: 48 }] }, bw); }, { style: "hud-tray", spacing: 8, width: tw, justify: "space-evenly" });
    });
    remember("tray", r, L.sc);
    tray.h = h + pad;
  }

  // --- the button board
  const region = { x: pad, y: topH + pad, w: inner, h: L.lh - topH - pad - (tray.h || pad) - (L.portrait ? 8 : 0) };
  const mb = mirror(L, region);
  // --- the desk in what is left
  let pf = { ...region };
  if (L.shortLand) pf = { ...region, w: Math.max(1, region.w - mb.w - 8) };
  else pf = { ...region, h: Math.max(1, region.h - mb.h - 10) };
  const f = frame();
  render.setPlayfield(L.ox + pf.x * L.sc, L.oy + pf.y * L.sc, pf.w * L.sc, pf.h * L.sc, f.width, f.height);
}

/** The button board in `region`'s bottom (beside the scene on short landscape); its size. */
function mirror(L: Layout, region: { x: number; y: number; w: number; h: number }): { w: number; h: number } {
  const g = game!;
  const st = g.sess.state;
  const rows = st.rows, cols = st.cols;
  const DOT = L.shortLand ? 12 : 16, GAP = 2, PAD = L.shortLand ? 6 : 12;
  const emph = !!settings.boardMirror;
  const maxW = L.shortLand ? Math.min(L.lw * 0.38, 320) : region.w;
  const maxH = L.shortLand ? region.h : region.h * (emph ? 0.55 : 0.4);
  const fixed = (n: number): number => (n + 1) * DOT + 2 * n * GAP + PAD * 2 + 2;
  let cell = Math.min((maxW - fixed(cols)) / cols, (maxH - fixed(rows)) / rows, emph ? 56 : 40);
  cell = Math.floor(Math.max(L.shortLand ? 14 : 18, cell));
  const tracks = (n: number): number[] => Array.from({ length: n * 2 + 1 }, (_, i) => (i % 2 === 0 ? DOT : cell));
  const w = fixed(cols) + cols * cell, h = fixed(rows) + rows * cell;
  const x = L.shortLand ? region.x + region.w - w : region.x + (region.w - w) / 2;
  const y = L.shortLand ? region.y + Math.max(0, (region.h - h) / 2) : region.y + region.h - h;
  const playable = !g.finished && !app.paused && !app.screen && isHumanTurn();
  ui.place("board-mirror", { anchor: "top-start", x, y }, () => {
    ui.grid("mirror-grid", () => {
      for (let gr = 0; gr <= rows * 2; gr++) {
        for (let gc = 0; gc <= cols * 2; gc++) {
          const r = gr >> 1, c = gc >> 1;
          if (gr % 2 === 0 && gc % 2 === 0) {
            ui.column(`d-${r}-${c}`, () => { ui.column(`dd-${r}-${c}`, () => undefined, { style: "mirror-dot", width: 12 * (DOT / 16), height: 12 * (DOT / 16) }); }, { width: DOT, height: DOT, align: "center", justify: "center" });
          } else if (gr % 2 === 0) edgeButton({ dir: "h", r, c }, cell, DOT, st.he[r]![c]!, playable);
          else if (gc % 2 === 0) edgeButton({ dir: "v", r, c }, DOT, cell, st.ve[r]![c]!, playable);
          else {
            const v = st.cells[r]![c]!;
            ui.column(`cell-${r}-${c}`, () => {
              if (v >= 0) ui.style("chip-name", { text: { color: `$p${v % 4}`, size: Math.max(10, cell * 0.45) } }).label(Content.PLAYER_STYLES[v % 4]!.icon);
            }, { style: v >= 0 ? "mirror-cell-claimed" : "mirror-cell", width: cell, height: cell, align: "center", justify: "center" });
          }
        }
      }
    }, { columns: tracks(cols), rows: tracks(rows), gap: GAP, width: w, style: "mirror", padding: PAD });
  });
  return { w, h };
}
function edgeButton(e: Edge, w: number, h: number, v: number, playable: boolean): void {
  const st = game!.sess.state;
  let label = edgeLabel(e);
  const cls = ["edge"];
  if (v === -1) { label += T(", pre-drawn"); cls.push("edge-pre"); }
  else if (v > 0) {
    const p = st.players[v - 1];
    label += T(", drawn by {name}", { name: p ? playerName(p) : T("player {n}", { n: v }) });
    cls.push(`edge-p${(v - 1) % 4}`);
  }
  if (app.hinted && sameEdge(app.hinted.edge, e)) cls.push("edge-hinted");
  if (sameEdge(app.focus, e) || sameEdge(app.armed, e)) cls.push("edge-focused");
  if (app.paused || app.screen) {
    // Under a dialog the board is a picture: buttons there would take the
    // dialog's clicks (they were built first).
    ui.column(`e-${e.dir}-${e.r}-${e.c}`, () => undefined, { style: v === 0 ? cls : [...cls, "edge-off"], width: w, height: h });
    return;
  }
  const hit = ui.style(...cls, { width: w, height: h }).id(`e-${e.dir}-${e.r}-${e.c}`).button(label, {
    disabled: v !== 0, content: () => undefined,
  });
  if (hit && playable) onPick(e);
}

// ------------------------------------------------------------------ toast, captions
function toastAndCaption(L: Layout): void {
  if (app.toast) {
    const text = app.toast.text();
    const w = Math.min(480, L.lw * (L.portrait ? 0.94 : 0.9));
    const h = sizeOf("toast", 0, 40).h;
    const bottom = (L.portrait && game && !app.screen ? 84 : 24);
    const r = ui.place("toast", { anchor: "top-start", x: (L.lw - Math.min(w, textWidth(text, "toast-text") + 44)) / 2, y: L.lh - bottom - h }, () => {
      ui.column("toast-box", () => para(text, w - 40, "toast-text", "toast-text", true), { style: "toast", align: "center" });
    });
    remember("toast", r, L.sc);
  }
  if (app.caption) {
    const w = Math.min(L.lw * 0.6, textWidth(app.caption.text, "caption-text") + 26);
    const h = sizeOf("caption", 0, 30).h;
    const x = settings.leftHanded ? L.lw - 16 - w : 16;
    const y = L.lh - 16 - h - (L.portrait && game && !app.screen ? tray.h : 0);
    const r = ui.place("captions", { anchor: "top-start", x, y }, () => {
      ui.column("caption-box", () => para(app.caption!.text, w - 24, "caption-text", "caption-text"), { style: "caption" });
    });
    remember("caption", r, L.sc);
  }
}

// ------------------------------------------------------------------ pause dialog
function pauseDialog(L: Layout): void {
  const w = Math.min(380, L.lw * 0.92);
  backdrop(L);
  const h = sizeOf("pause", 0, 300).h;
  const r = ui.place("pause-panel", { anchor: "top-start", x: (L.lw - w) / 2, y: Math.max(8, (L.lh - h) / 2) }, () => {
    ui.style("screen-title", { text: { align: "center" } }).heading(T("Paused"));
    const bw = w - 52;
    ui.column("pause-btns", () => {
      button({ id: "btn-resume", text: T("Resume"), style: ["btn", "btn-primary"], act: resumeGame }, bw);
      button({ id: "btn-pause-settings", text: T("Settings"), act: () => showScreen("settings") }, bw);
      button({ id: "btn-pause-help", text: T("Help"), act: () => showScreen("help") }, bw);
      button({ id: "btn-leave", text: T("Leave sheet"), style: ["btn", "btn-ghost"], act: leaveSheet }, bw);
    }, { spacing: 10, width: bw });
  }, { style: "panel", width: w, spacing: 16, align: "center" });
  remember("pause", r, L.sc);
}
function backdrop(L: Layout): void {
  ui.place("backdrop", { anchor: "top-start", x: -L.ox / L.sc, y: -L.oy / L.sc }, () => undefined, { style: "backdrop", width: frame().width / L.sc, height: frame().height / L.sc });
}

// ------------------------------------------------------------------ dialog screens
const SCREEN_TITLES: Record<string, string> = {
  title: "Boxes & Lines", practice: "Practice", journey: "Journey", challenge: "Challenge", learn: "Learn",
  settings: "Settings", help: "Help", profile: "Profile", scores: "Scores", results: "Results",
};
function screen(L: Layout): void {
  const name = app.screen!;
  const compact = L.portrait || L.shortLand;
  const w = Math.min(680, L.lw * 0.92, L.lw - 16);
  const padX = compact ? 14 : 26, padY = compact ? 12 : 22;
  const inner = w - padX * 2 - 2;
  const maxH = Math.min(L.lh * 0.88, L.lh - 16);
  backdrop(L);
  const content = sizeOf(`scr-${name}`, 0, 0).h;
  const head = sizeOf("screen-head", 0, 50).h;
  const scroll = content + head + padY * 2 + 14 > maxH;
  const h = scroll ? maxH : content + head + padY * 2 + 16;
  ui.place("screen-panel", { anchor: "top-start", x: (L.lw - w) / 2, y: Math.max(8, (L.lh - h) / 2) }, () => {
    const hr = ui.row("screen-head", () => {
      if (canGoBack()) button({ id: "screen-back", text: T("← Back"), style: ["btn", "btn-ghost"], act: screenBack });
      ui.style("screen-title", compact ? { text: { size: 22 } } : {}).id("screen-title").heading(name === "title" ? "Boxes & Lines" : T(SCREEN_TITLES[name]!));
    }, { spacing: 14, align: "center", width: inner });
    remember("screen-head", hr, L.sc);
    const body = (): void => {
      const r = ui.column(`body-${name}`, () => buildScreen(name, inner - (scroll ? 14 : 0), L), { spacing: 14, width: inner - (scroll ? 14 : 0) });
      remember(`scr-${name}`, r, L.sc);
    };
    if (scroll) ui.scrollArea(`scroll-${name}`, { width: inner, height: h - padY * 2 - head - 16 }, body, { padding: 4 });
    else body();
  }, { style: compact ? "panel-compact" : "panel", width: w, height: h, spacing: 14 });
}
function buildScreen(name: string, w: number, L: Layout): void {
  switch (name) {
    case "title": titleScreen(w, L); break;
    case "practice": practiceScreen(w); break;
    case "journey": journeyScreen(w); break;
    case "challenge": challengeScreen(w); break;
    case "learn": learnScreen(w); break;
    case "results": resultsScreen(w, L); break;
    case "settings": settingsScreen(w); break;
    case "help": helpScreen(w); break;
    case "profile": profileScreen(w); break;
    case "scores": scoresScreen(w); break;
  }
}
function h3(text: string): void { ui.style("h3").label(text); }

/** A card button: a title and an optional sub line (`label` is its accessible name). */
function card(id: string, label: string, title: string, sub: string, w: number, primary: boolean, act: () => void): void {
  const inner = w - 44;
  const clicked = ui.style(primary ? "card-primary" : "card", { width: w }).id(id).button(label, {
    content: () => {
      ui.column(`${id}-face`, () => {
        para(title, inner, "card-title");
        if (sub) para(sub, inner, "card-sub");
      }, { spacing: 6, width: inner });
    },
  });
  if (clicked) act();
}
/** Cards in an auto-fit grid of `min` px columns. */
function cardGrid(label: string, cards: { id: string; label: string; title: string; sub: string; primary?: boolean; act: () => void }[], w: number, min = 220): void {
  const gap = 14;
  const cols = fitColumns(w, min, gap);
  const cw = (w - gap * (cols - 1)) / cols;
  ui.grid(label, () => {
    for (const c of cards) card(c.id, c.label, c.title, c.sub, cw, !!c.primary, c.act);
  }, { columns: cols, gap, width: w });
}

// ------------------------------------------------------------------ title
function titleCards(): { id: string; label: string; title: string; sub: string; primary?: boolean; act: () => void }[] {
  const p = platform.progress();
  const next = Content.JOURNEY.find((lv) => (p.journeyStars[lv.id] || 0) === 0);
  const cards = [];
  if (next) {
    cards.push({
      id: "card-play", primary: true, title: "▶ " + T("Play"), label: T("Play next journey stage: {name}", { name: T(next.name) }),
      sub: T("Journey {n} — {name}", { n: (next.index ?? 0) + 1, name: T(next.name) }), act: () => startGame(next),
    });
  } else {
    cards.push({ id: "card-play", primary: true, title: "▶ " + T("Play"), label: "▶ " + T("Play"), sub: T("Practice a fresh sheet"), act: () => showScreen("practice") });
  }
  const done = p.dailiesDone[utcDate()];
  cards.push({
    id: "card-daily", title: T("Daily Sheet"), label: T("Daily Sheet"),
    sub: done != null ? T("Done today — score {n}", { n: done }) : T("New shared sheet · {countdown}", { countdown: dailyCountdown() }), act: startDaily,
  });
  cards.push({ id: "card-journey", title: T("Journey"), label: T("Journey"), sub: T("{n} ★ earned", { n: totalStars() }), act: () => showScreen("journey") });
  cards.push({ id: "card-practice", title: T("Practice"), label: T("Practice"), sub: T("Unranked, undo allowed"), act: () => showScreen("practice") });
  cards.push({ id: "card-challenge", title: T("Challenge"), label: T("Challenge"), sub: T("Constrained goals"), act: () => showScreen("challenge") });
  cards.push({ id: "card-learn", title: T("Learn"), label: T("Learn"), sub: T("Five short lessons"), act: () => showScreen("learn") });
  return cards;
}
function accountLine(): string {
  if (app.signedOut) return T("Signed out of StarHermit — progress stays on this device.");
  const name = platform.displayName();
  if (!name) return T("Offline — progress is stored on this device.");
  const s = platform.syncState();
  return T("Playing as {name}", { name }) + " · " + (s === "error" ? T("cloud sync unavailable") : s === "saving" ? T("saving…") : T("progress synced"));
}
function titleScreen(w: number, L: Layout): void {
  art(titleArt, w, L.lh < 700 ? 16 / 4 : 16 / 7, 1024 / 576);
  cardGrid("card-grid", titleCards(), w);
  flow("title-links", [
    { id: "link-scores", text: T("Scores"), style: ["btn", "btn-ghost"], act: () => showScreen("scores") },
    { id: "link-settings", text: T("Settings"), style: ["btn", "btn-ghost"], act: () => showScreen("settings") },
    { id: "link-help", text: T("Help"), style: ["btn", "btn-ghost"], act: () => showScreen("help") },
    { id: "link-profile", text: T("Profile"), style: ["btn", "btn-ghost"], act: () => showScreen("profile") },
  ], w);
  const account: Btn[] = [];
  const link = platform.inviteLink();
  if (link) {
    account.push({
      id: "btn-invite", text: T("Invite a friend"), style: ["btn", "btn-ghost"],
      act: () => { try { clipboard.writeText(link); toast(T("Invite link copied to the clipboard.")); } catch { toast(T("Could not copy the invite link.") + " " + link); } },
    });
  }
  if (!platform.signedIn()) account.push({ id: "btn-sign-in", text: T("Sign in with StarHermit"), style: ["btn", "btn-ghost"], act: () => { void requestSignIn().catch(() => undefined); } });
  if (account.length) flow("title-account", account, w);
  para(accountLine(), w, "dim", "account-line");
}

// ------------------------------------------------------------------ practice, journey, challenge, learn
function practiceScreen(w: number): void {
  h3(T("Sheet size"));
  flow("seg-size", Content.PRACTICE.map((p, i) => ({
    id: `size-${p.id}`, text: T(p.name) + " · " + p.rows + "×" + p.cols, style: ["seg-btn"], selected: app.practicePreset === i,
    act: () => { app.practicePreset = i; },
  })), w, "start", 8);
  h3(T("Rival"));
  flow("seg-ai", Content.AI_LEVELS.map((lv) => ({
    id: `ai-${lv}`, text: Content.AI_NAMES[lv] + " · " + T(lv), style: ["seg-btn"], selected: app.practiceAi === lv,
    act: () => { app.practiceAi = lv; },
  })), w, "start", 8);
  para(T("Practice is unranked: undo is allowed, ratings are untouched. Expect 2–8 minutes."), w, "dim", "practice-note");
  button({ id: "btn-start", text: T("Start sheet"), style: ["btn", "btn-primary", "btn-big"], act: startPractice }, Math.min(w, buttonWidth(T("Start sheet"), ["btn", "btn-primary", "btn-big"])));
}
/** A list row: number, name, meta and stars on one line (the goal under it), its accessible name `label`. */
function levelRow(id: string, label: string, parts: { num?: string; name: string; meta?: string; stars: string; goal?: string }, w: number, cls: string[], disabled: boolean, act: () => void): void {
  const inner = w - 34;
  const numW = parts.num ? textWidth("00", "level-num") + 4 : 0;
  const metaW = parts.meta ? textWidth(parts.meta, "level-meta") : 0;
  const starW = textWidth(parts.stars || " ", "level-stars");
  const nameW = Math.max(60, inner - numW - metaW - starW - 30);
  const clicked = ui.style(...cls, { width: w }).id(id).button(label, {
    disabled,
    content: () => {
      ui.column(`${id}-face`, () => {
        ui.row(`${id}-line`, () => {
          if (parts.num) ui.style("level-num", { width: numW }).label(parts.num);
          ui.column(`${id}-name`, () => para(parts.name, nameW, "level-name"), { width: nameW });
          if (parts.meta) ui.style("level-meta").label(parts.meta);
          ui.style("level-stars").label(parts.stars || " ");
        }, { spacing: 10, align: "center", width: inner });
        if (parts.goal) para(parts.goal, inner, "level-goal");
      }, { spacing: 4, width: inner });
    },
  });
  if (clicked && !disabled) act();
}
function journeyLabel(i: number): string {
  const lv = Content.JOURNEY[i]!;
  const p = platform.progress();
  const open = i === 0 || (p.journeyStars[Content.JOURNEY[i - 1]!.id] || 0) > 0;
  return T("Stage {n}: {name}", { n: i + 1, name: T(lv.name) }) + (open ? T(", {n} stars", { n: p.journeyStars[lv.id] || 0 }) : T(", locked"));
}
function journeyScreen(w: number): void {
  const p = platform.progress();
  let unlocked = true;
  ui.column("level-list", () => {
    Content.JOURNEY.forEach((lv, i) => {
      const stars = p.journeyStars[lv.id] || 0;
      const open = unlocked;
      unlocked = stars > 0;
      const cls = ["level-row"];
      if (lv.mastery) cls.push("level-mastery");
      levelRow(`stage-${i + 1}`, journeyLabel(i), {
        num: String(i + 1).padStart(2, "0"), name: T(lv.name),
        meta: lv.rows + "×" + lv.cols + (lv.timeLimitSec ? " · " + T("timed") : ""), stars: open ? starsText(stars) : "—",
      }, w, cls, !open, () => startGame(lv));
    });
  }, { spacing: 8, width: w });
}
function challengeScreen(w: number): void {
  const p = platform.progress();
  ui.column("level-list", () => {
    for (const c of Content.CHALLENGES) {
      const best = p.challengeBest[c.id];
      levelRow(`challenge-${c.id}`, T(c.name), {
        name: T(c.name), meta: c.rows + "×" + c.cols + (c.timeLimitSec ? " · " + T("timed") : ""),
        stars: best != null ? String(best) : "—", goal: T(c.goalText ?? ""),
      }, w, ["level-row"], false, () => startGame(c));
    }
  }, { spacing: 8, width: w });
}
function lessonLabel(i: number): string {
  const l = Content.tutorialLessons()[i]!;
  return T("Lesson {n}: {name}", { n: i + 1, name: T(l.title) }) + (platform.progress().tutorialDone[l.id] ? T(", complete") : "");
}
function learnScreen(w: number): void {
  const done = platform.progress().tutorialDone;
  ui.column("level-list", () => {
    Content.tutorialLessons().forEach((l, i) => {
      levelRow(`lesson-${l.id}`, lessonLabel(i), { num: String(i + 1), name: T(l.title), stars: done[l.id] ? "✓" : "" }, w, ["level-row"], false, () => startLesson(i));
    });
  }, { spacing: 8, width: w });
}

// ------------------------------------------------------------------ results
function resultsScreen(w: number, L: Layout): void {
  const r = app.results;
  if (!r) { goTitle(); return; }
  if (r.won && !r.lesson) art(winArt, Math.min(w, L.shortLand ? 140 : 220), 1, 1);
  ui.style(r.won ? "result-win" : "result-lose").id("result-headline").heading(T(r.headline));
  para(r.sub(), w, "dim", "result-sub");
  if (r.stars != null) ui.style("result-stars").id("result-stars").label(starsText(r.stars), { tooltip: T("{n} of 3 stars", { n: r.stars }) });
  if (!r.lesson) {
    ui.style("bd-caption").label(T("Score breakdown"));
    ui.grid("breakdown", () => {
      for (const c of r.breakdown.components) {
        ui.style("bd-td").label(T(c.label));
        ui.style("bd-num").label(String(c.points));
      }
      ui.style("bd-total").label(T("Total"));
      ui.style("bd-total").id("results-total").label(String(r.breakdown.total));
    }, { columns: [{ fr: 1 }, { width: "auto", align: "end" }], gap: 0, width: w, rowStyle: "bd-row" });
  }
  if (r.achievements.length) {
    ui.style("bd-caption").label(T("Achievements unlocked"));
    ui.column("ach-new", () => {
      for (const a of r.achievements) ui.column(`ach-new-${a.key}`, () => para("★ " + T(a.name) + " — " + T(a.desc), w - 26, "text"), { style: "ach", width: w });
    }, { spacing: 6, width: w });
  }
  if (r.posting || r.lb) {
    const lb = r.lb;
    para(r.posting || !lb ? T("Posting score to the leaderboard…") : !lb.posted ? T("Score not posted to the leaderboard.") : lb.rank ? T("Leaderboard rank: #{rank}", { rank: lb.rank }) : T("Score posted to the leaderboard."), w, "dim", "results-lb");
  }
  const row: Btn[] = [{ id: "btn-retry", text: "↻ " + T("Retry"), style: ["btn", "btn-primary"], act: retry }];
  if (r.canNext) row.push({ id: "btn-next", text: T("Next") + " →", act: nextSheet });
  row.push({ id: "btn-title", text: T("Title"), style: ["btn", "btn-ghost"], act: goTitle });
  flow("results-row", row, w);
}

// ------------------------------------------------------------------ settings, help, profile, scores
function settingsScreen(w: number): void {
  const check = (key: string, label: string): void => {
    ui.row(`row-${key}`, () => {
      const cur = !!settings[key];
      const next = ui.id(`set-${key}`).checkbox(T(label), cur);
      if (next !== cur) platform.setSetting(key, next);
    }, { style: "setting-row", width: w, align: "center" });
  };
  const select = (key: string, label: string, options: [string, string][]): void => {
    ui.row(`row-${key}`, () => {
      para(T(label), w * 0.4, "setting-label");
      ui.spacer();
      const idx = Math.max(0, options.findIndex(([v]) => v === settings[key]));
      const next = ui.id(`set-${key}`).select(T(label), idx, options.map(([, l]) => l));
      if (next !== idx) platform.setSetting(key, options[next]![0]);
    }, { style: "setting-row", width: w, align: "center", spacing: 16 });
  };
  const stars = totalStars();
  h3(T("Audio"));
  check("captions", "Captions for sound cues");
  h3(T("Graphics"));
  select("theme", "Desk theme", Content.THEMES.map((t) => [t.id, T(t.name) + (stars < t.unlockStars ? " (" + T("locked") + " · " + t.unlockStars + "★)" : "")]));
  select("colorPalette", "Player colors", [["standard", T("Standard")], ["high-visibility", T("High visibility")]]);
  h3(T("Controls & access"));
  check("leftHanded", "Left-handed layout");
  check("confirmMoves", "Confirm moves (tap edge twice)");
  check("boardMirror", "Always show button board");
  check("haptics", "Haptics");
  // Sound, graphics, language, controls and accessibility are the runtime's Options.
  para(T("Volumes, graphics quality, frame rate, language, controls, reduced motion, high contrast and text size are in the StarHermit Options menu."), w, "dim", "options-note");
  flow("settings-btns", [
    { id: "btn-options", text: T("More options…"), act: () => openMenu() },
    { id: "btn-replay", text: T("Replay lessons"), style: ["btn", "btn-ghost"], act: () => { if (!game || game.finished) { if (game) goTitle(); showScreen("learn"); } else showScreen("learn"); } },
  ], w);
}
function helpScreen(w: number): void {
  const cards: [string, string][] = [
    ["Draw a line", T("Tap a faint edge between two dots (or move the focus ring with arrow keys and press Enter). One line per turn.")],
    ["Claim a box", T("When your line closes the fourth side of a box, the box folds into your color and stamp — and you draw again.")],
    ["Extra turns chain", T("Claimed boxes grant another line immediately. Long chains swing a match; so can giving one away.")],
    ["The third side is a gift", T("A line that gives a box its third side usually hands it to your rival. The risk lamp warns you before you commit.")],
    ["Winning", T("When the sheet is full, most boxes wins. Ties break on fewer invalid moves, then faster time.")],
    ["Controls", T("Pointer/touch: tap an edge. Keyboard: {keys}. Gamepad: stick/d-pad moves focus, A draws, B cancels, Start pauses.", { keys: keysText() })],
  ];
  const gap = 12, cols = fitColumns(w, 220, gap), cw = (w - gap * (cols - 1)) / cols;
  ui.grid("help-grid", () => {
    cards.forEach(([title, text], i) => {
      ui.column(`help-${i}`, () => {
        para(T(title), cw - 30, "help-h");
        ui.style("help-p").paragraph(text, cw - 30);
      }, { style: "help-card", width: cw, spacing: 6 });
    });
  }, { columns: cols, gap, width: w });
}
let nameDraft: string | null = null;
function profileScreen(w: number): void {
  const p = platform.progress(), st = p.stats;
  ui.row("row-name", () => {
    para(T("Display name"), w * 0.4, "setting-label");
    ui.spacer();
    const account = platform.displayName();
    if (account) {
      // Signed in: the name is the platform profile's (read-only here).
      ui.style("setting-label").label(account);
      ui.style("dim").label(T("(platform account)"));
    } else {
      const cur = nameDraft ?? (platform.data.profileName || T("Guest"));
      const next = ui.textField("profile-name", cur, { maxChars: 16, width: Math.min(220, w * 0.5) });
      if (next !== cur) nameDraft = next;
      if (ui.submitted("profile-name") || (nameDraft != null && ui.focused() !== "profile-name" && !ui.capturingKeys())) {
        const n = (nameDraft ?? cur).trim().slice(0, 16) || T("Guest");
        nameDraft = null;
        if (n !== platform.data.profileName) { platform.data.profileName = n; platform.persist(); ui.announce(T("Display name set to {name}", { name: n })); }
      }
    }
  }, { style: "setting-row", width: w, align: "center", spacing: 10 });
  const stats: [string, string][] = [
    ["Matches", String(st.rounds)], ["Wins", String(st.wins)], ["Boxes claimed", String(st.boxesClaimed)],
    ["Best chain", String(st.bestChain)], ["Journey stars", String(totalStars())], ["Time played", fmtTime(st.playMs)],
  ];
  const gap = 10, cols = fitColumns(w, 120, gap), cw = (w - gap * (cols - 1)) / cols;
  ui.grid("stat-grid", () => {
    stats.forEach(([k, v], i) => ui.column(`stat-${i}`, () => {
      ui.style("stat-val").label(v);
      para(T(k), cw - 26, "stat-label", undefined, true);
    }, { style: "stat", width: cw, align: "center", spacing: 2 }));
  }, { columns: cols, gap, width: w });
  h3(T("Achievements"));
  ui.column("ach-list", () => {
    for (const a of Store.ACHIEVEMENTS) {
      const got = !!p.achievements[a.key];
      ui.column(`ach-${a.key}`, () => para((got ? "★ " : "○ ") + T(a.name) + " — " + T(a.desc), w - 26, got ? "text" : "faint"), { style: got ? "ach" : "ach-dim", width: w });
    }
  }, { spacing: 6, width: w });
}
let platformRows: { userId: string; score: number; you: boolean }[] | null = null;
let platformFetch = -1;
function scoresScreen(w: number): void {
  if (platform.signedIn() && platformFetch !== app.openedFrame) {
    platformFetch = app.openedFrame;
    void platform.platformBoard().then((rows) => { platformRows = rows && rows.length ? rows : null; });
  }
  const tabs: ("Global" | "Platform")[] = platformRows ? ["Global", "Platform"] : ["Global"];
  if (!tabs.includes(app.scoresTab)) app.scoresTab = "Global";
  flow("score-tabs", tabs.map((k) => ({ id: `tab-${k}`, text: T(k), style: ["seg-btn"], selected: app.scoresTab === k, act: () => { app.scoresTab = k; } })), w, "start", 8);
  const rows: { name: string; score: number; board: string; time: string; you: boolean }[] = app.scoresTab === "Platform"
    ? (platformRows ?? []).map((e) => ({ name: e.you ? T("You ({name})", { name: platform.nameFor(e.userId) }) : platform.nameFor(e.userId), score: e.score, board: T("platform"), time: "", you: e.you }))
    : Store.loadBoards().entries.slice(0, 20).map((e: BoardEntry) => ({ name: e.name, score: e.score, board: e.board, time: fmtTime(e.durationMs), you: false }));
  if (!rows.length) { para(T("No verified scores yet — finish a ranked sheet to post one."), w, "dim", "scores-empty"); return; }
  ui.grid("scores-table", () => {
    for (const h of ["#", "Name", "Score", "Board", "Time"]) ui.style("bd-th").label(T(h));
    rows.slice(0, 20).forEach((r, i) => {
      const cls = r.you ? "bd-you" : "bd-td";
      ui.style(cls).label(String(i + 1));
      ui.style(cls).label(r.name);
      ui.style(cls).label(String(r.score));
      ui.style(cls).label(r.board);
      ui.style(cls).label(r.time);
    });
  }, { columns: ["auto", { fr: 1 }, "auto", "auto", "auto"], gap: 0, width: w, rowStyle: "bd-row" });
}
