// Запуск: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  abilityModifier, formatModifier, skillBonus, savingThrowBonus, initiativeBonus,
  advantageLabel, spendPool, restorePool, SKILLS,
} from "../js/rules.js";
import {
  parseFormula, rollFormula, rollD20, d20FromRolls, d20Request, formulaRequest, formulaFromValues,
} from "../js/dice.js";
import { createCharacter, normalizeCharacter } from "../js/character.js";

// Предсказуемый «генератор»: выдаёт заданные значения по кругу (0..1).
const fixed = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

test("модификатор характеристики", () => {
  assert.equal(abilityModifier(10), 0);
  assert.equal(abilityModifier(11), 0);
  assert.equal(abilityModifier(9), -1);
  assert.equal(abilityModifier(8), -1);
  assert.equal(abilityModifier(1), -5);
  assert.equal(abilityModifier(20), 5);
  assert.equal(abilityModifier(30), 10);
  assert.equal(abilityModifier(""), 0, "пустое значение считается как 10");
  assert.equal(abilityModifier("abc"), 0);
  assert.equal(abilityModifier(99), 10, "значение ограничено 30");
});

test("формат модификатора", () => {
  assert.equal(formatModifier(3), "+3");
  assert.equal(formatModifier(0), "+0");
  assert.equal(formatModifier(-2), "−2");
});

test("спасброски и навыки равны модификатору характеристики, без бонусов", () => {
  const c = createCharacter();
  c.abilities.str = 16;
  c.abilities.wis = 7;
  assert.equal(savingThrowBonus(c, "str"), 3);
  assert.equal(savingThrowBonus(c, "wis"), -2);
  for (const s of SKILLS) {
    assert.equal(skillBonus(c, s), abilityModifier(c.abilities[s.ability]), s.name);
  }
});

test("инициатива — модификатор ловкости без бонусов", () => {
  const c = createCharacter();
  c.abilities.dex = 14;
  c.combat.initiativeMisc = 1; // поле прошлой версии игнорируется
  assert.equal(initiativeBonus(c), 2);
});

test("18 навыков, у всех уникальные id", () => {
  assert.equal(SKILLS.length, 18);
  assert.equal(new Set(SKILLS.map((s) => s.id)).size, 18);
});

test("пулы (хиты, мана) не уходят ниже нуля и выше максимума", () => {
  assert.deepEqual(spendPool({ current: 3, max: 20 }, 10), { current: 0, max: 20 });
  assert.deepEqual(spendPool({ current: 10, max: 20 }, 4), { current: 6, max: 20 });
  assert.deepEqual(restorePool({ current: 15, max: 20 }, 10), { current: 20, max: 20 });
});

test("подпись преимущества и помехи", () => {
  assert.equal(advantageLabel(0), "Обычный бросок");
  assert.equal(advantageLabel(1), "Преимущество");
  assert.equal(advantageLabel(3), "Преимущество ×3");
  assert.equal(advantageLabel(-2), "Помеха ×2");
});

test("разбор формул", () => {
  assert.deepEqual(parseFormula("2d6+3"), [
    { kind: "dice", sign: 1, count: 2, sides: 6 },
    { kind: "flat", sign: 1, value: 3 },
  ]);
  assert.deepEqual(parseFormula("d20 - 1"), [
    { kind: "dice", sign: 1, count: 1, sides: 20 },
    { kind: "flat", sign: -1, value: 1 },
  ]);
  assert.equal(parseFormula("4к6")[0].sides, 6, "русская «к» работает");
  assert.throws(() => parseFormula(""), /Пустая/);
  assert.throws(() => parseFormula("2d"), /Не понимаю/);
  assert.throws(() => parseFormula("d1"), /Граней/);
  assert.throws(() => parseFormula("1000d6"), /Кубиков/);
});

test("бросок формулы", () => {
  const r = rollFormula("2d6+3", fixed(0, 0.99));
  assert.deepEqual(r.parts[0].rolls, [1, 6]);
  assert.equal(r.total, 10);
  assert.equal(r.text, "[1, 6] + 3");
});

test("d20: многократные преимущество и помеха", () => {
  assert.equal(rollD20(5, 0, fixed(0.99)).total, 25);
  assert.equal(rollD20(5, 0, fixed(0.99)).crit, true);
  assert.equal(rollD20(0, 0, fixed(0)).fumble, true);
  const adv2 = rollD20(1, 2, fixed(0.2, 0.7, 0.45));
  assert.deepEqual(adv2.rolls, [5, 15, 10], "преимущество ×2 — три d20");
  assert.equal(adv2.d20, 15);
  assert.equal(adv2.total, 16);
  const dis3 = rollD20(0, -3, fixed(0.2, 0.7, 0.45, 0.9));
  assert.equal(dis3.rolls.length, 4, "помеха ×3 — четыре d20");
  assert.equal(dis3.d20, 5);
});

test("d20 по значениям 3D-кубиков", () => {
  assert.deepEqual(d20FromRolls([19, 5], 3, 1), { d20: 19, rolls: [19, 5], total: 22, crit: false, fumble: false });
  assert.equal(d20FromRolls([19, 5, 1], 0, -2).fumble, true);
});

test("запросы к 3D-кубикам", () => {
  assert.deepEqual(d20Request(4, 0), { dice: ["D20"], bonus: 4 });
  assert.deepEqual(d20Request(-1, 2), { dice: ["D20", "D20", "D20"], bonus: -1, combination: "HIGHEST" });
  assert.deepEqual(d20Request(0, -1), { dice: ["D20", "D20"], bonus: 0, combination: "LOWEST" });
  assert.deepEqual(formulaRequest(parseFormula("2d6+1d4-1")), { dice: ["D6", "D6", "D4"], bonus: -1 });
  assert.deepEqual(formulaRequest(parseFormula("d100")), { dice: [{ dice: ["D100", "D10"] }], bonus: 0 });
  assert.equal(formulaRequest(parseFormula("1d20-1d4")), null, "вычитание кубиков — встроенный генератор");
  assert.equal(formulaRequest(parseFormula("3d7")), null, "нестандартные грани — встроенный генератор");
  assert.equal(formulaRequest(parseFormula("21d6")), null, "больше 20 кубиков — встроенный генератор");
  assert.equal(formulaRequest(parseFormula("5")), null);
});

test("результат формулы по значениям 3D-кубиков", () => {
  const r = formulaFromValues(parseFormula("2d6+1d4+2"), [3, 5, 2]);
  assert.equal(r.total, 12);
  assert.equal(r.text, "[3, 5] + [2] + 2");
});

test("нормализация отбрасывает мусор и ограничивает значения", () => {
  const c = normalizeCharacter({
    name: 42, abilities: { str: 50, dex: "abc" }, hp: { current: 500, max: 20 },
    resources: [{ name: "Мана", current: 9, max: 4 }, { name: "Дзен" }],
    attacks: [{ name: "Меч", bonus: "5", damage: "1d8+3" }, null], evil: "<script>",
  });
  assert.equal(c.name, "");
  assert.equal(c.abilities.str, 30);
  assert.equal(c.abilities.dex, 10);
  assert.deepEqual(c.hp, { max: 20, current: 20 });
  assert.equal(c.resources.length, 2);
  assert.equal(c.resources[0].current, 4, "текущее не больше максимума");
  assert.equal(c.resources[1].max, 5);
  assert.equal(c.attacks.length, 2);
  assert.equal(c.attacks[0].bonus, 5);
  assert.equal("evil" in c, false);
});

test("миграция: лишние поля прошлых версий отбрасываются", () => {
  const v3 = normalizeCharacter({
    version: 3, name: "Гимли", className: "Воин", level: 7, abilities: { str: 18 },
    saves: { str: true }, skills: { athletics: 2 }, combat: { ac: 16, inspiration: true, initiativeMisc: 2 },
    hp: { current: 30, max: 40, temp: 5 },
  });
  assert.equal(v3.name, "Гимли");
  assert.equal(v3.abilities.str, 18);
  assert.equal(v3.combat.ac, 16);
  assert.deepEqual(v3.hp, { max: 40, current: 30 });
  for (const field of ["className", "level", "saves", "skills"]) assert.equal(field in v3, false, field);
  assert.equal("inspiration" in v3.combat, false);
  assert.equal("initiativeMisc" in v3.combat, false);

  const v1 = normalizeCharacter({ name: "Арагорн", str: "16", dex: "14", con: "12", int: "10", wis: "13", cha: "8" });
  assert.equal(v1.name, "Арагорн");
  assert.equal(v1.abilities.str, 16);
  assert.equal(v1.abilities.cha, 8);
});

test("manifest.json проходит ограничения Owlbear", async () => {
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.manifest_version, 1);
  for (const field of ["name", "version", "description", "author"]) {
    assert.equal(typeof manifest[field], "string", field);
  }
  assert.ok(manifest.description.length <= 128, `description: ${manifest.description.length} > 128 символов`);
  for (const url of [manifest.icon, manifest.action.icon, manifest.action.popover, manifest.background_url]) {
    assert.match(url, /^https:\/\/maxcrash72\.github\.io\/dnd-sheet\//);
  }
});
