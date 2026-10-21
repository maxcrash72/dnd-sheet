// Правила: упрощённая система на основе D&D 5e — без уровней, классов и бонуса мастерства.
// Спасброски и навыки всегда равны модификатору своей характеристики.
// Чистые функции без DOM и SDK.

export const ABILITIES = [
  { id: "str", name: "Сила", short: "СИЛ" },
  { id: "dex", name: "Ловкость", short: "ЛОВ" },
  { id: "con", name: "Телосложение", short: "ТЕЛ" },
  { id: "int", name: "Интеллект", short: "ИНТ" },
  { id: "wis", name: "Мудрость", short: "МДР" },
  { id: "cha", name: "Харизма", short: "ХАР" },
];

export const SKILLS = [
  { id: "athletics", name: "Атлетика", ability: "str" },
  { id: "acrobatics", name: "Акробатика", ability: "dex" },
  { id: "sleight", name: "Ловкость рук", ability: "dex" },
  { id: "stealth", name: "Скрытность", ability: "dex" },
  { id: "investigation", name: "Анализ", ability: "int" },
  { id: "history", name: "История", ability: "int" },
  { id: "arcana", name: "Магия", ability: "int" },
  { id: "nature", name: "Природа", ability: "int" },
  { id: "religion", name: "Религия", ability: "int" },
  { id: "perception", name: "Внимательность", ability: "wis" },
  { id: "survival", name: "Выживание", ability: "wis" },
  { id: "medicine", name: "Медицина", ability: "wis" },
  { id: "insight", name: "Проницательность", ability: "wis" },
  { id: "animal", name: "Уход за животными", ability: "wis" },
  { id: "performance", name: "Выступление", ability: "cha" },
  { id: "intimidation", name: "Запугивание", ability: "cha" },
  { id: "deception", name: "Обман", ability: "cha" },
  { id: "persuasion", name: "Убеждение", ability: "cha" },
];

export const SCORE_MIN = 1;
export const SCORE_MAX = 30;
/** Сколько дополнительных d20 может дать преимущество или помеха */
export const MAX_ADVANTAGE = 5;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Приводит ввод к целому числу; пустое или некорректное значение заменяется fallback. */
export function toInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function abilityModifier(score) {
  return Math.floor((clamp(toInt(score, 10), SCORE_MIN, SCORE_MAX) - 10) / 2);
}

export function formatModifier(mod) {
  return mod >= 0 ? `+${mod}` : `−${Math.abs(mod)}`;
}

/** Спасбросок и навык — просто модификатор характеристики, без дополнительных бонусов. */
export function savingThrowBonus(character, abilityId) {
  return abilityModifier(character.abilities[abilityId]);
}

export function skillBonus(character, skill) {
  return abilityModifier(character.abilities[skill.ability]);
}

/** Инициатива — модификатор ловкости, без дополнительных бонусов. */
export function initiativeBonus(character) {
  return abilityModifier(character.abilities.dex);
}

/** Подпись режима броска: 0 — обычный, +N — преимущество (N доп. кубов), −N — помеха. */
export function advantageLabel(advantage) {
  if (!advantage) return "Обычный бросок";
  const kind = advantage > 0 ? "Преимущество" : "Помеха";
  const n = Math.abs(advantage);
  return n === 1 ? kind : `${kind} ×${n}`;
}

/** Уменьшает пул (хиты, мана…) не ниже нуля. */
export function spendPool(pool, amount) {
  return { ...pool, current: Math.max(0, pool.current - Math.max(0, toInt(amount, 0))) };
}

/** Восстанавливает пул не выше максимума. */
export function restorePool(pool, amount) {
  return { ...pool, current: Math.min(pool.max, pool.current + Math.max(0, toInt(amount, 0))) };
}
