// Хранение листа: localStorage браузера (основное) + метаданные игрока в OBR (резервная копия).

import OBR, { PLUGIN_ID } from "./obr.js";
import { normalizeCharacter, createCharacter } from "./character.js";

const META_KEY = `${PLUGIN_ID}/character`;
const LEGACY_META_KEY = "ru_dnd_sheet/v2";
const SAVE_DELAY_MS = 400;

function roomKey(kind) {
  const room = OBR.isAvailable ? OBR.room.id : "standalone";
  return `dnd-sheet:${kind}:${room}`;
}

export function readLocal(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Загружает персонажа: localStorage → метаданные игрока → старый формат → пустой лист. */
export async function loadCharacter() {
  const local = readLocal(roomKey("character"));
  if (local) return normalizeCharacter(local);
  if (OBR.isAvailable) {
    try {
      const meta = await OBR.player.getMetadata();
      const saved = meta[META_KEY] ?? meta[LEGACY_META_KEY];
      if (saved) return normalizeCharacter(saved);
    } catch (e) {
      console.warn("[dnd-sheet] не удалось прочитать метаданные игрока", e);
    }
  }
  return createCharacter();
}

let timer = null;
let pending = null;

/** Сохраняет с задержкой, чтобы не писать на каждое нажатие клавиши. */
export function scheduleSave(character, onResult) {
  pending = character;
  clearTimeout(timer);
  timer = setTimeout(() => flush(onResult), SAVE_DELAY_MS);
}

async function flush(onResult) {
  const character = pending;
  pending = null;
  if (!character) return;
  const localOk = writeLocal(roomKey("character"), character);
  let remoteOk = !OBR.isAvailable;
  if (OBR.isAvailable) {
    try {
      await OBR.player.setMetadata({ [META_KEY]: character, [LEGACY_META_KEY]: undefined });
      remoteOk = true;
    } catch (e) {
      console.warn("[dnd-sheet] не удалось сохранить в метаданные игрока", e);
    }
  }
  onResult?.(localOk || remoteOk);
}

export function loadSettings(defaults) {
  return { ...defaults, ...(readLocal("dnd-sheet:settings") ?? {}) };
}

export function saveSettings(settings) {
  writeLocal("dnd-sheet:settings", settings);
}

export function loadLog() {
  const log = readLocal(roomKey("log"));
  return Array.isArray(log) ? log : [];
}

export function saveLog(log) {
  writeLocal(roomKey("log"), log);
}
