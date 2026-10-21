// Кубики: генератор, разбор формул вида «2d6+1d4+3», подготовка запросов к 3D-кубикам. Без DOM и SDK.

export const MAX_DICE = 100;
export const MAX_SIDES = 1000;
/** Кубики, которые умеет бросать расширение Dice */
export const DICE_3D_SIDES = [4, 6, 8, 10, 12, 20, 100];
export const MAX_DICE_3D = 20;

/** Случайное целое 1..sides (источник — crypto, если доступно). */
export function rollDie(sides, random = defaultRandom) {
  return Math.floor(random() * sides) + 1;
}

function defaultRandom() {
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return buf[0] / 2 ** 32;
  }
  return Math.random();
}

/**
 * Разбирает формулу. Поддерживает кубики (d20, 2к6 — русская «к» тоже), числа, + и −.
 * Возвращает массив слагаемых или бросает Error с понятным сообщением.
 */
export function parseFormula(formula) {
  const src = String(formula ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/к/g, "d")
    .replace(/[−–]/g, "-");
  if (!src) throw new Error("Пустая формула");
  if (!/^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/.test(src)) {
    throw new Error(`Не понимаю формулу «${formula}». Пример: 2d6+3`);
  }
  const terms = [];
  for (const match of src.matchAll(/([+-]?)(\d*d\d+|\d+)/g)) {
    const sign = match[1] === "-" ? -1 : 1;
    const body = match[2];
    if (body.includes("d")) {
      const [countStr, sidesStr] = body.split("d");
      const count = countStr === "" ? 1 : Number(countStr);
      const sides = Number(sidesStr);
      if (count < 1 || count > MAX_DICE) throw new Error(`Кубиков должно быть от 1 до ${MAX_DICE}`);
      if (sides < 2 || sides > MAX_SIDES) throw new Error(`Граней должно быть от 2 до ${MAX_SIDES}`);
      terms.push({ kind: "dice", sign, count, sides });
    } else {
      terms.push({ kind: "flat", sign, value: Number(body) });
    }
  }
  return terms;
}

/** Сколько кубиков в формуле, по порядку: [6, 6, 4] для «2d6+1d4». */
function diceSides(terms) {
  return terms.filter((t) => t.kind === "dice").flatMap((t) => Array(t.count).fill(t.sides));
}

/**
 * Считает результат формулы по уже выпавшим значениям (по одному на кубик, в порядке формулы).
 * Результат: { total, parts: [{ sign, sides?, rolls?, value }], text }
 */
export function formulaFromValues(terms, values) {
  let i = 0;
  let total = 0;
  const parts = terms.map((t) => {
    if (t.kind === "flat") {
      total += t.sign * t.value;
      return { sign: t.sign, value: t.value };
    }
    const rolls = values.slice(i, i + t.count);
    i += t.count;
    const sum = rolls.reduce((a, b) => a + b, 0);
    total += t.sign * sum;
    return { sign: t.sign, sides: t.sides, rolls, value: sum };
  });
  return { total, parts, text: describeParts(parts) };
}

/** Бросает формулу встроенным генератором. */
export function rollFormula(formula, random) {
  const terms = parseFormula(formula);
  return formulaFromValues(terms, diceSides(terms).map((sides) => rollDie(sides, random)));
}

function describeParts(parts) {
  return parts
    .map((p, i) => {
      const sign = p.sign < 0 ? " − " : i === 0 ? "" : " + ";
      const body = p.rolls ? `[${p.rolls.join(", ")}]` : String(p.value);
      return sign + body;
    })
    .join("");
}

/** Сколько d20 бросается: один основной + по одному за каждый уровень преимущества/помехи. */
export function d20Count(advantage) {
  return 1 + Math.abs(advantage || 0);
}

/**
 * Итог броска d20 по выпавшим кубикам: при преимуществе берётся лучший, при помехе — худший.
 * Возвращает { d20, rolls, total, crit, fumble }.
 */
export function d20FromRolls(rolls, modifier, advantage = 0) {
  const d20 = advantage > 0 ? Math.max(...rolls) : advantage < 0 ? Math.min(...rolls) : rolls[0];
  return { d20, rolls, total: d20 + modifier, crit: d20 === 20, fumble: d20 === 1 };
}

/** Бросок d20 встроенным генератором. advantage: 0 — обычный, +N — преимущество, −N — помеха. */
export function rollD20(modifier, advantage = 0, random) {
  const rolls = Array.from({ length: d20Count(advantage) }, () => rollDie(20, random));
  return d20FromRolls(rolls, modifier, advantage);
}

/** Запрос к 3D-кубикам для броска d20 (формат API расширения Dice). */
export function d20Request(modifier, advantage = 0) {
  const roll = { dice: Array(d20Count(advantage)).fill("D20"), bonus: modifier };
  if (advantage) roll.combination = advantage > 0 ? "HIGHEST" : "LOWEST";
  return roll;
}

/**
 * Запрос к 3D-кубикам для формулы или null, если её нельзя бросить настоящими кубиками
 * (вычитание кубиков, нестандартные грани, слишком много кубиков). d100 — пара D100 + D10.
 */
export function formulaRequest(terms) {
  const dice = terms.filter((t) => t.kind === "dice");
  const count = dice.reduce((n, t) => n + t.count * (t.sides === 100 ? 2 : 1), 0);
  if (!dice.length || count > MAX_DICE_3D) return null;
  if (dice.some((t) => t.sign < 0 || !DICE_3D_SIDES.includes(t.sides))) return null;
  const bonus = terms.filter((t) => t.kind === "flat").reduce((sum, t) => sum + t.sign * t.value, 0);
  return {
    dice: diceSides(terms).map((sides) => (sides === 100 ? { dice: ["D100", "D10"] } : `D${sides}`)),
    bonus,
  };
}
