// Кубики: честный генератор и разбор формул вида «2d6+1d4+3». Без DOM и SDK.

export const MAX_DICE = 100;
export const MAX_SIDES = 1000;

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

/** Бросает формулу. Результат: { total, parts: [{ sign, sides?, rolls?, value }], text } */
export function rollFormula(formula, random) {
  const terms = parseFormula(formula);
  let total = 0;
  const parts = terms.map((t) => {
    if (t.kind === "flat") {
      total += t.sign * t.value;
      return { sign: t.sign, value: t.value };
    }
    const rolls = Array.from({ length: t.count }, () => rollDie(t.sides, random));
    const sum = rolls.reduce((a, b) => a + b, 0);
    total += t.sign * sum;
    return { sign: t.sign, sides: t.sides, rolls, value: sum };
  });
  return { total, parts, text: describeParts(parts) };
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

export const ROLL_MODES = ["normal", "advantage", "disadvantage"];

/**
 * Бросок d20 с модификатором и режимом (преимущество/помеха).
 * Возвращает { d20, rolls, total, crit, fumble }.
 */
export function rollD20(modifier, mode = "normal", random) {
  const first = rollDie(20, random);
  const rolls = [first];
  let d20 = first;
  if (mode === "advantage" || mode === "disadvantage") {
    const second = rollDie(20, random);
    rolls.push(second);
    d20 = mode === "advantage" ? Math.max(first, second) : Math.min(first, second);
  }
  return { d20, rolls, total: d20 + modifier, crit: d20 === 20, fumble: d20 === 1 };
}

/** Удваивает количество кубиков в формуле (критическое попадание). */
export function critFormula(formula) {
  return parseFormula(formula)
    .map((t, i) => {
      const sign = t.sign < 0 ? "-" : i === 0 ? "" : "+";
      return t.kind === "dice" ? `${sign}${t.count * 2}d${t.sides}` : `${sign}${t.value}`;
    })
    .join("");
}
