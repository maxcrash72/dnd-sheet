// Подстраивает цвета листа под тему Owlbear Rodeo (светлая/тёмная, акцентный цвет).

import OBR from "./obr.js";

function applyTheme(theme) {
  const root = document.documentElement;
  root.dataset.mode = theme.mode === "LIGHT" ? "light" : "dark";
  const vars = {
    "--bg": theme.background.paper,
    "--text": theme.text.primary,
    "--muted": theme.text.secondary,
    "--accent": theme.primary.main,
    "--accent-text": theme.primary.contrastText,
    "--surface": "color-mix(in srgb, var(--text) 6%, var(--bg))",
    "--surface-2": "color-mix(in srgb, var(--text) 11%, var(--bg))",
    "--border": "color-mix(in srgb, var(--text) 18%, var(--bg))",
  };
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
}

export async function initTheme() {
  if (!OBR.isAvailable) return;
  try {
    applyTheme(await OBR.theme.getTheme());
    OBR.theme.onChange(applyTheme);
  } catch (e) {
    console.warn("[dnd-sheet] не удалось получить тему", e);
  }
}
