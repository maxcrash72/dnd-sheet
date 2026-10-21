// Правила D&D 5e: характеристики, навыки, бонусы. Чистые функции без DOM и SDK.

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

// Уровень владения навыком: 0 — нет, 1 — владение, 2 — компетентность (двойной бонус).
export const PROFICIENCY_LEVELS = [0, 1, 2];

export const SCORE_MIN = 1;
export const SCORE_MAX = 30;
export const LEVEL_MIN = 1;
export const LEVEL_MAX = 20;

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

export function proficiencyBonus(level) {
  return 2 + Math.floor((clamp(toInt(level, 1), LEVEL_MIN, LEVEL_MAX) - 1) / 4);
}

export function formatModifier(mod) {
  return mod >= 0 ? `+${mod}` : `−${Math.abs(mod)}`;
}

export function savingThrowBonus(character, abilityId) {
  const mod = abilityModifier(character.abilities[abilityId]);
  return character.saves[abilityId] ? mod + proficiencyBonus(character.level) : mod;
}

export function skillBonus(character, skill) {
  const mod = abilityModifier(character.abilities[skill.ability]);
  const level = character.skills[skill.id] ?? 0;
  return mod + level * proficiencyBonus(character.level);
}

export function initiativeBonus(character) {
  return abilityModifier(character.abilities.dex) + toInt(character.combat.initiativeMisc, 0);
}

export function passivePerception(character) {
  const perception = SKILLS.find((s) => s.id === "perception");
  return 10 + skillBonus(character, perception);
}

/** Применяет урон: сначала списываются временные хиты, затем текущие (не ниже нуля). */
export function applyDamage(hp, amount) {
  const dmg = Math.max(0, toInt(amount, 0));
  const fromTemp = Math.min(hp.temp, dmg);
  return {
    ...hp,
    temp: hp.temp - fromTemp,
    current: Math.max(0, hp.current - (dmg - fromTemp)),
  };
}

/** Лечение не поднимает хиты выше максимума. */
export function applyHealing(hp, amount) {
  const heal = Math.max(0, toInt(amount, 0));
  return { ...hp, current: Math.min(hp.max, hp.current + heal) };
}
