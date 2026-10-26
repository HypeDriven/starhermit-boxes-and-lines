// Localization: the browser build's string tables (js/strings.js through
// js/i18n.js, the nine StarHermit locales, English text as the key) in the
// interface language the runtime reports (preferences().language: the
// player's choice in Options › Language, else the account's preferred
// language or the device's). The runtime's Options replaced the game's own
// Language menu (sh-language.js).
import { onPreferencesChange, preferences } from "starhermit:engine";
import * as ui from "starhermit:ui";
import { I18n } from "./classic.ts";

let locale = "";
const listeners = new Set<() => void>();
function apply(tag: string): void {
  const next = I18n.match(tag);
  if (next === locale) return;
  locale = I18n.setLocale(next);
  ui.setLanguage(locale);
  for (const fn of listeners) fn();
}
apply(preferences().language);
onPreferencesChange((p) => apply(p.language));

export function currentLocale(): string { return locale; }
/** fn() after the interface language changed. */
export function onLocaleChange(fn: () => void): void { listeners.add(fn); }

/** A game string by its English key in the player's language; `{name}` placeholders from vars. */
export function T(key: string, vars?: Record<string, string | number> | null): string {
  return I18n.T(key, vars ?? null);
}
