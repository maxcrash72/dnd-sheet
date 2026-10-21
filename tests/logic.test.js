// Запуск: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  abilityModifier, proficiencyBonus, formatModifier, skillBonus, savingThrowBonus,
  passivePerception, applyDamage, applyHealing, SKILLS,
} from "../js/rules.js";
import { parseFormula, rollFormula, rollD20, critFormula } from "../js/dice.js";
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

test("бонус мастерства по уровню", () => {
  assert.deepEqual([1, 4, 5, 8, 9, 12, 13, 16, 17, 20].map(proficiencyBonus), [2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
});

test("формат модификатора", () => {
  assert.equal(formatModifier(3), "+3");
  assert.equal(formatModifier(0), "+0");
  assert.equal(formatModifier(-2), "−2");
});

test("навыки, спасброски и пассивная внимательность учитывают владение", () => {
  const c = createCharacter();
  c.level = 5; // БМ +3
  c.abilities.wis = 14; // +2
  c.abilities.str = 16; // +3
  const perception = SKILLS.find((s) => s.id === "perception");
  assert.equal(skillBonus(c, perception), 2);
  c.skills.perception = 1;
  assert.equal(skillBonus(c, perception), 5);
  c.skills.perception = 2;
  assert.equal(skillBonus(c, perception), 8);
  assert.equal(passivePerception(c), 18);
  assert.equal(savingThrowBonus(c, "str"), 3);
  c.saves.str = true;
  assert.equal(savingThrowBonus(c, "str"), 6);
});

test("18 навыков, у всех уникальные id", () => {
  assert.equal(SKILLS.length, 18);
  assert.equal(new Set(SKILLS.map((s) => s.id)).size, 18);
});

test("урон сначала снимает временные хиты, лечение не выше максимума", () => {
  assert.deepEqual(applyDamage({ current: 10, max: 20, temp: 5 }, 8), { current: 7, max: 20, temp: 0 });
  assert.deepEqual(applyDamage({ current: 3, max: 20, temp: 0 }, 10), { current: 0, max: 20, temp: 0 });
  assert.deepEqual(applyHealing({ current: 15, max: 20, temp: 0 }, 10), { current: 20, max: 20, temp: 0 });
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

test("d20: преимущество, помеха, крит и провал", () => {
  assert.equal(rollD20(5, "normal", fixed(0.99)).total, 25);
  assert.equal(rollD20(5, "normal", fixed(0.99)).crit, true);
  const adv = rollD20(0, "advantage", fixed(0.2, 0.7));
  assert.deepEqual(adv.rolls, [5, 15]);
  assert.equal(adv.d20, 15);
  assert.equal(rollD20(0, "disadvantage", fixed(0.2, 0.7)).d20, 5);
  assert.equal(rollD20(0, "normal", fixed(0)).fumble, true);
});

test("критический урон удваивает кубики, но не модификатор", () => {
  assert.equal(critFormula("1d8+3"), "2d8+3");
  assert.equal(critFormula("2d6+1d4-1"), "4d6+2d4-1");
});

test("нормализация отбрасывает мусор и ограничивает значения", () => {
  const c = normalizeCharacter({
    version: 3, name: 42, level: 99, abilities: { str: 50, dex: "abc" },
    skills: { stealth: 7, athletics: 2 }, hp: { current: 500, max: 20, temp: -3 },
    attacks: [{ name: "Меч", bonus: "5", damage: "1d8+3" }, null], evil: "<script>",
  });
  assert.equal(c.name, "");
  assert.equal(c.level, 20);
  assert.equal(c.abilities.str, 30);
  assert.equal(c.abilities.dex, 10);
  assert.equal(c.skills.stealth, 0);
  assert.equal(c.skills.athletics, 2);
  assert.deepEqual(c.hp, { current: 20, max: 20, temp: 0 });
  assert.equal(c.attacks.length, 2);
  assert.equal(c.attacks[0].bonus, 5);
  assert.equal("evil" in c, false);
});

test("миграция листа из версии 1.x", () => {
  const c = normalizeCharacter({ name: "Арагорн", str: "16", dex: "14", con: "12", int: "10", wis: "13", cha: "8" });
  assert.equal(c.name, "Арагорн");
  assert.equal(c.abilities.str, 16);
  assert.equal(c.abilities.cha, 8);
  assert.equal(c.level, 1);
});
