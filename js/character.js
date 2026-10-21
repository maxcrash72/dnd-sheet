// Модель персонажа: значения по умолчанию, проверка загруженных данных, миграция старых форматов.

import { ABILITIES, SCORE_MIN, SCORE_MAX, clamp, toInt } from "./rules.js";

export const SCHEMA_VERSION = 4;
export const MAX_ATTACKS = 20;
export const MAX_RESOURCES = 6;
const MAX_TEXT = 80;
const MAX_NOTES = 4000;
const MAX_POOL = 9999;

export function createCharacter() {
  return {
    version: SCHEMA_VERSION,
    name: "",
    abilities: Object.fromEntries(ABILITIES.map((a) => [a.id, 10])),
    combat: { ac: 10, speed: 30 },
    hp: { current: 10, max: 10 },
    resources: [],
    attacks: [],
    notes: "",
  };
}

export function createAttack() {
  return { id: randomId(), name: "", bonus: 0, damage: "1d6" };
}

/** Дополнительный пул вроде маны или дзена: только текущее и максимальное значение. */
export function createResource() {
  return { id: randomId(), name: "", current: 5, max: 5 };
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `a${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function text(value, max = MAX_TEXT) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function id(value) {
  return typeof value === "string" && value ? value.slice(0, 64) : randomId();
}

function pool(raw, fallbackMax) {
  const max = clamp(toInt(raw?.max, fallbackMax), 1, MAX_POOL);
  return { max, current: clamp(toInt(raw?.current, max), 0, max) };
}

/**
 * Приводит произвольные данные (из хранилища, файла импорта) к корректному персонажу.
 * Неизвестные поля отбрасываются, числа ограничиваются допустимыми диапазонами.
 * Поля прошлых версий (уровень, класс, владения, временные хиты, бонус инициативы) просто игнорируются.
 */
export function normalizeCharacter(raw) {
  const base = createCharacter();
  if (!raw || typeof raw !== "object") return base;
  const src = migrate(raw);

  base.name = text(src.name);
  for (const a of ABILITIES) {
    base.abilities[a.id] = clamp(toInt(src.abilities?.[a.id], 10), SCORE_MIN, SCORE_MAX);
  }
  base.combat.ac = clamp(toInt(src.combat?.ac, 10), 0, 99);
  base.combat.speed = clamp(toInt(src.combat?.speed, 30), 0, 999);
  base.hp = pool(src.hp, 10);
  base.resources = (Array.isArray(src.resources) ? src.resources : [])
    .slice(0, MAX_RESOURCES)
    .map((r) => ({ id: id(r?.id), name: text(r?.name, 40), ...pool(r, 5) }));
  base.attacks = (Array.isArray(src.attacks) ? src.attacks : []).slice(0, MAX_ATTACKS).map((a) => ({
    id: id(a?.id),
    name: text(a?.name),
    bonus: clamp(toInt(a?.bonus, 0), -20, 30),
    damage: text(a?.damage, 40),
  }));
  base.notes = text(src.notes, MAX_NOTES);
  return base;
}

/**
 * Самый старый формат v1.x (ключ "ru_dnd_sheet/v2" в метаданных игрока):
 * { name, str: "10", dex: "14", ... } — только имя и значения характеристик.
 */
function migrate(raw) {
  const looksLegacy = ABILITIES.some((a) => a.id in raw) && !raw.abilities;
  if (!looksLegacy) return raw;
  return {
    name: raw.name,
    abilities: Object.fromEntries(ABILITIES.map((a) => [a.id, raw[a.id]])),
  };
}
