// The look of the menus, HUD and button board: the browser build's style
// sheet, rewritten class-based in tools/ui-style.css and converted once with
// `starhermit css` into assets/ui-style.json (`npm run css`), registered at
// start with the theme the runtime's own widgets (checkboxes, selects,
// text fields, scroll bars) fall back to. The browser build's body classes
// that swapped the palette are token sets here: high contrast (the
// runtime's accessibility option) and the high-visibility player colours.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

type Tokens = Record<string, string>;
let base: Tokens = {};

export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  base = { ...(css.tokens as Tokens) };
  ui.setTheme({
    fontSize: 16, smallSize: 13, headingSize: 24, padding: 8, spacing: 8, radius: 10,
    text: "#2a211b", muted: "#5c4f41", panel: "#f2ead8", control: "#fffdf6", hovered: "#e9dfc8",
    pressed: "#d8cbae", field: "#fffdf6", accent: "#c9821e", focus: "#e8a33f", outline: "#d8cbae",
  });
  ui.setTokens(css.tokens);
  ui.setAnimations(css.animations);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$ink" } },
    paragraph: { text: { color: "$ink" } },
    checkbox: {
      text: { color: "$ink", weight: "600" }, minHeight: 36,
      parts: { box: { background: "$card", border: { width: 2, color: "$ink-soft" }, radius: 4 }, mark: { background: "$amber-deep" } },
    },
    select: { parts: { field: { background: "$card", border: { width: 2, color: "$paper-edge" }, radius: 10, minHeight: 44 } } },
    textField: { background: "$card", border: { width: 2, color: "$paper-edge" }, radius: 10, minHeight: 44, text: { color: "$ink" } },
    grid: { background: "#00000000" },
    stack: { background: "#00000000" },
    scrollArea: { parts: { bar: { background: "$ink-faint", radius: 4 } } },
  });
}

let paletteKey = "";
/** The palette tokens: high contrast (darker desk, brighter paper, black ink),
 * the high-visibility player colours, else the sheet's. */
export function applyPalette(highContrast: boolean, highVisibility: boolean): void {
  const key = `${highContrast}:${highVisibility}`;
  if (key === paletteKey) return;
  paletteKey = key;
  const tokens: Tokens = { ...base };
  if (highContrast) Object.assign(tokens, {
    desk: "#100b06", "desk-2": "#181008", paper: "#fdf6e6", "paper-2": "#f2e6cc", "paper-edge": "#6b5a42",
    ink: "#171008", "ink-soft": "#332619", "ink-faint": "#4a3a28", rule: "#a79577",
  });
  if (highVisibility) Object.assign(tokens, { p0: "#2e6fe4", p1: "#e4572e", p2: "#f5d90a", p3: "#17a398" });
  ui.setTokens(tokens);
}
