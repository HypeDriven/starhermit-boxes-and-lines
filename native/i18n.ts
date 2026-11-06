// Localization: the engine's string tables (assets/strings.json, generated from
// the browser build's: the nine StarHermit locales, English text as the key;
// en-GB, es-ES and fr-CA hold their differences, the chain reads the rest) in
// the interface language the runtime reports (the player's choice in Options ›
// Language, else the account's preferred language or the device's). The
// account lines are the engine's `starhermit.*` keys.
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
const listeners = new Set<() => void>();
strings.onChange((locale) => {
  ui.setLanguage(locale);
  for (const fn of listeners) fn();
});

/** fn() after the interface language changed. */
export function onLocaleChange(fn: () => void): void { listeners.add(fn); }

/** A game string by its English key in the player's language; `{name}` placeholders from vars. */
export function T(key: string, vars?: Record<string, string | number> | null): string {
  return strings.t(key, vars ?? undefined);
}
