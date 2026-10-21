// Хранение листов.
// Основное место — метаданные комнаты Owlbear: они сохраняются между сессиями и видны мастеру.
// Каждый лист лежит под своим ключом …/sheet/<id игрока> (id игрока постоянный), в сжатом виде.
// Копия в localStorage браузера — кэш для мгновенной загрузки и запас, если в комнате нет места.

import OBR, { PLUGIN_ID } from "./obr.js";
import { normalizeCharacter, createCharacter } from "./character.js";
import { encodeSheet, decodeSheet, metadataSize } from "./codec.js";

const SHEET_PREFIX = `${PLUGIN_ID}/sheet/`;
// Ключи версий 1.x–2.x в метаданных игрока (они не сохраняются между сессиями)
const OLD_PLAYER_KEYS = [`${PLUGIN_ID}/character`, "ru_dnd_sheet/v2"];
/** Лимит Owlbear на все метаданные комнаты (общий для всех расширений) */
export const ROOM_LIMIT = 16 * 1024;
const ROOM_SAFE_LIMIT = ROOM_LIMIT - 512;
export const MAX_SHEET_BYTES = 3000;
const SAVE_DELAY_MS = 600;

function roomId() {
  return OBR.isAvailable ? OBR.room.id : "standalone";
}

function roomKey(kind) {
  return `dnd-sheet:${kind}:${roomId()}`;
}

function localSheetKey(playerId) {
  return `dnd-sheet:sheet:${roomId()}:${playerId}`;
}

export function sheetKey(playerId) {
  return SHEET_PREFIX + playerId;
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

export function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1).replace(".", ",")} КБ`;
}

// ---------- Листы в комнате ----------

/** Листы, сохранённые в комнате: [{ playerId, playerName, characterName, updatedAt, size }]. */
export function listSheets(metadata) {
  return Object.entries(metadata)
    .filter(([key, entry]) => key.startsWith(SHEET_PREFIX) && entry && typeof entry === "object")
    .map(([key, entry]) => ({
      playerId: key.slice(SHEET_PREFIX.length),
      playerName: typeof entry.playerName === "string" ? entry.playerName : "",
      characterName: typeof entry.characterName === "string" ? entry.characterName : "",
      updatedAt: Number(entry.updatedAt) || 0,
      size: metadataSize(entry),
    }));
}

/** Сколько байт занимают все метаданные комнаты. */
export function roomUsage(metadata) {
  return metadataSize(metadata);
}

/**
 * Загружает лист игрока: комната → кэш браузера → лист старой версии → пустой.
 * Возвращает { character, inRoom } — inRoom=false значит, что в комнате листа ещё нет.
 */
export async function loadSheet(playerId) {
  if (OBR.isAvailable) {
    const entry = (await OBR.room.getMetadata())[sheetKey(playerId)];
    if (entry?.data) {
      try {
        const character = normalizeCharacter(await decodeSheet(entry.data));
        seen.set(playerId, entry.data);
        writeLocal(localSheetKey(playerId), character);
        return { character, inRoom: true };
      } catch (e) {
        console.warn("[dnd-sheet] лист в комнате повреждён, беру копию из браузера", e);
      }
    }
  }
  const local = readLocal(localSheetKey(playerId)) ?? (isMe(playerId) ? readLocal(roomKey("character")) : null);
  if (local) return { character: normalizeCharacter(local), inRoom: false };
  if (OBR.isAvailable && isMe(playerId)) {
    try {
      const meta = await OBR.player.getMetadata();
      const old = OLD_PLAYER_KEYS.map((k) => meta[k]).find(Boolean);
      if (old) return { character: normalizeCharacter(old), inRoom: false };
    } catch (e) {
      console.warn("[dnd-sheet] не удалось прочитать метаданные игрока", e);
    }
  }
  return { character: createCharacter(), inRoom: false };
}

function isMe(playerId) {
  return !OBR.isAvailable || playerId === OBR.player.id;
}

/** Последние данные листа, записанные или прочитанные этим окном, — чтобы не применять своё же эхо. */
const seen = new Map();

/**
 * Записывает лист в комнату. Возвращает { ok, error? }.
 * playerName — имя игрока для списка мастера; если не указано, сохраняется прежнее.
 */
async function writeRoom(playerId, character, playerName) {
  const data = await encodeSheet(character);
  if (data.length > MAX_SHEET_BYTES) {
    return { ok: false, error: `Лист слишком большой для комнаты (${formatKb(data.length)}): сократите заметки или списки` };
  }
  const key = sheetKey(playerId);
  const metadata = await OBR.room.getMetadata();
  const entry = {
    playerName: playerName ?? metadata[key]?.playerName ?? "",
    characterName: character.name.slice(0, 40),
    updatedAt: Date.now(),
    data,
  };
  if (roomUsage({ ...metadata, [key]: entry }) > ROOM_SAFE_LIMIT) {
    return { ok: false, error: "В комнате закончилось место для листов (лимит Owlbear — 16 КБ). Лист сохранён только в этом браузере" };
  }
  seen.set(playerId, data);
  await OBR.room.setMetadata({ [key]: entry });
  return { ok: true };
}

const timers = new Map();
const pending = new Map();

/** Есть ли несохранённые изменения этого листа. */
export function hasPendingSave(playerId) {
  return pending.has(playerId);
}

/** Сохраняет с задержкой, чтобы не писать в комнату на каждое нажатие клавиши. */
export function scheduleSave(playerId, character, { playerName, onResult } = {}) {
  pending.set(playerId, { character, playerName, onResult });
  clearTimeout(timers.get(playerId));
  timers.set(playerId, setTimeout(() => flushSave(playerId), SAVE_DELAY_MS));
}

/** Немедленно сохраняет отложенные изменения листа (например, перед переключением на другой лист). */
export async function flushSave(playerId) {
  clearTimeout(timers.get(playerId));
  const job = pending.get(playerId);
  pending.delete(playerId);
  if (!job) return;
  const { character, playerName, onResult } = job;
  writeLocal(localSheetKey(playerId), character);
  if (!OBR.isAvailable) return onResult?.({ ok: true, local: true });
  try {
    onResult?.(await writeRoom(playerId, character, playerName));
  } catch (e) {
    console.warn("[dnd-sheet] не удалось сохранить лист в комнату", e);
    onResult?.({ ok: false, error: "Не удалось сохранить лист в комнату, копия осталась в браузере" });
  }
}

/** Переносит лист старой версии в комнату и убирает старые ключи из метаданных игрока. */
export async function uploadSheet(playerId, character, playerName) {
  const result = await writeRoom(playerId, character, playerName);
  if (result.ok && isMe(playerId)) {
    OBR.player.setMetadata(Object.fromEntries(OLD_PLAYER_KEYS.map((k) => [k, undefined]))).catch(() => {});
  }
  return result;
}

/** Удаляет лист из комнаты (только мастер). */
export async function deleteSheet(playerId) {
  seen.delete(playerId);
  await OBR.room.setMetadata({ [sheetKey(playerId)]: undefined });
}

/**
 * Следит за листом в комнате: вызывает callback(character), когда его изменил кто-то другой
 * (мастер правит лист игрока или игрок правит свой, пока мастер его смотрит).
 */
export function watchSheet(playerId, callback) {
  if (!OBR.isAvailable) return () => {};
  return OBR.room.onMetadataChange(async (metadata) => {
    const data = metadata[sheetKey(playerId)]?.data;
    if (!data || data === seen.get(playerId) || pending.has(playerId)) return;
    seen.set(playerId, data);
    try {
      const character = normalizeCharacter(await decodeSheet(data));
      writeLocal(localSheetKey(playerId), character);
      callback(character);
    } catch (e) {
      console.warn("[dnd-sheet] не удалось прочитать обновлённый лист", e);
    }
  });
}

// ---------- Настройки и журнал (только в браузере) ----------

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
