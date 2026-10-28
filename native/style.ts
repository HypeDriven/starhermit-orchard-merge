// The look of the menus, HUD and screens: the browser build's <style>,
// rewritten class-based in tools/ui-style.css and converted once with
// `starhermit css` into assets/ui-style.json (`npm run css`), registered at
// start with the theme the runtime's own widgets (checkboxes, selects,
// sliders, scroll bars) take, in the system sans. High contrast (the
// runtime's option) swaps the tokens as body.high-contrast swapped the CSS
// variables.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

let base: Record<string, string | number> = {};
const HIGH_CONTRAST = {
  bg: "#000000", panel: "#111111", panel2: "#000000", ink: "#ffffff", dim: "#e8e8e8",
  accent: "#ffd400", accent2: "#00ff88", danger: "#ff4444", line: "#888888", hud: "#000000f0", scrim: "#000000d0",
};

export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  base = { ...(css.tokens as Record<string, string | number>) };
  ui.setFont({ family: "system-ui" });
  ui.setTheme({
    fontSize: 16, smallSize: 14, headingSize: 24, padding: 8, spacing: 10, radius: 12,
    text: "#f4eedd", muted: "#c9c2a8", panel: "#2c4023", control: "#243620", hovered: "#2c4023",
    pressed: "#3a5530", field: "#243620", accent: "#ffb84d", focus: "#ffb84d", outline: "#55704a",
  });
  ui.setTokens(css.tokens);
  ui.setAnimations(css.animations);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$ink" } },
    paragraph: { text: { color: "$ink" } },
    heading: { text: { color: "$ink" } },
    widget: { focusRing: { color: "$accent", width: 3, offset: 2 } },
    checkbox: {
      text: { color: "$ink" }, minHeight: 44,
      parts: { box: { background: "$panel2", border: { width: 2, color: "$line" }, radius: 4 }, mark: { background: "$accent" } },
    },
    select: { background: "$panel2", border: { width: 2, color: "$line" }, radius: 8, text: { color: "$ink" }, minHeight: 44 },
    slider: { minHeight: 44, parts: { track: { background: "#00000066", radius: 4 }, thumb: { background: "$accent", radius: 999 } } },
    scrollArea: { parts: { bar: { background: "#c9c2a866", radius: 4 } } },
    tooltip: { background: "$panel", text: { color: "$ink" }, radius: 6, padding: 6 },
  });
}

let hc: boolean | null = null;
/** body.high-contrast's variables while the runtime's high contrast is on. */
export function applyContrast(on: boolean): void {
  if (hc === on) return;
  hc = on;
  ui.setTokens(on ? { ...base, ...HIGH_CONTRAST } : base);
}
