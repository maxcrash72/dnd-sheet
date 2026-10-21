// Модель персонажа: значения по умолчанию, проверка загруженных данных, миграция старого формата.

import { ABILITIES, SKILLS, PROFICIENCY_LEVELS, SCORE_MIN, SCORE_MAX, LEVEL_MIN, LEVEL_MAX, clamp, toInt } from "./rules.js";

export const SCHEMA_VERSION = 3;
export const MAX_ATTACKS = 20;
const MAX_TEXT = 80;
const MAX_NOTES = 4000;

export function createCharacter() {
  return {
    version: SCHEMA_VERSION,
    name: "",
    className: "",
    level: 1,
    abilities: Object.fromEntries(ABILITIES.map((a) => [a.id, 10])),
    saves: Object.fromEntries(ABILITIES.map((a) => [a.id, false])),
    skills: Object.fromEntries(SKILLS.map((s) => [s.id, 0])),
    combat: { ac: 10, speed: 30, initiativeMisc: 0, inspiration: false },
    hp: { current: 10, max: 10, temp: 0 },
    attacks: [],
    notes: "",
  };
}

export function createAttack() {
  return { id: randomId(), name: "", bonus: 0, damage: "1d6" };
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `a${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function text(value, max = MAX_TEXT) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * Приводит произвольные данные (из хранилища, файла импорта) к корректному персонажу.
 * Неизвестные поля отбрасываются, числа ограничиваются допустимыми диапазонами.
 */
export function normalizeCharacter(raw) {
  const base = createCharacter();
  if (!raw || typeof raw !== "object") return base;
  const src = raw.version === SCHEMA_VERSION ? raw : migrate(raw);

  base.name = text(src.name);
  base.className = text(src.className);
  base.level = clamp(toInt(src.level, 1), LEVEL_MIN, LEVEL_MAX);
  for (const a of ABILITIES) {
    base.abilities[a.id] = clamp(toInt(src.abilities?.[a.id], 10), SCORE_MIN, SCORE_MAX);
    base.saves[a.id] = Boolean(src.saves?.[a.id]);
  }
  for (const s of SKILLS) {
    const level = toInt(src.skills?.[s.id], 0);
    base.skills[s.id] = PROFICIENCY_LEVELS.includes(level) ? level : 0;
  }
  base.combat.ac = clamp(toInt(src.combat?.ac, 10), 0, 99);
  base.combat.speed = clamp(toInt(src.combat?.speed, 30), 0, 999);
  base.combat.initiativeMisc = clamp(toInt(src.combat?.initiativeMisc, 0), -20, 20);
  base.combat.inspiration = Boolean(src.combat?.inspiration);
  base.hp.max = clamp(toInt(src.hp?.max, 10), 1, 9999);
  base.hp.current = clamp(toInt(src.hp?.current, base.hp.max), 0, base.hp.max);
  base.hp.temp = clamp(toInt(src.hp?.temp, 0), 0, 9999);
  base.attacks = (Array.isArray(src.attacks) ? src.attacks : []).slice(0, MAX_ATTACKS).map((a) => ({
    id: typeof a?.id === "string" ? a.id.slice(0, 64) : randomId(),
    name: text(a?.name),
    bonus: clamp(toInt(a?.bonus, 0), -20, 30),
    damage: text(a?.damage, 40),
  }));
  base.notes = text(src.notes, MAX_NOTES);
  return base;
}

/**
 * Старый формат v1.x (ключ "ru_dnd_sheet/v2" в метаданных игрока):
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
