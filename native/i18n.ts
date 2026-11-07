// Localization: the engine's string tables (assets/strings.json: US-English text
// as the keys, the nine StarHermit locales) in the interface language the runtime
// reports (the player's choice in Options › Language, else the account's preferred
// language or the device's). The runtime's Options replace the game's own Language
// setting (sh-language.js) and the DOM re-labelling: every string is drawn through
// T() each frame, so a change shows on the next frame. The account lines are the
// engine's `starhermit.*` keys.
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
strings.onChange((locale) => ui.setLanguage(locale));

type Vars = Record<string, string | number>;
/** An English source string in the player's language; `{name}` placeholders from vars. */
export function T(key: string, vars?: Vars | null): string {
  const k = String(key ?? "");
  if (strings.has(k)) return strings.t(k, vars ?? undefined);
  return vars ? k.replace(/\{(\w+)\}/g, (m, n: string) => (vars[n] != null ? String(vars[n]) : m)) : k;
}
/** Marks an English key that is translated with T() where it is shown. */
export const N = (s: string): string => s;
/** An account line: the engine's `starhermit.<key>` string. */
export function account(key: string, vars?: Vars): string { return strings.t(`starhermit.${key}`, vars); }
