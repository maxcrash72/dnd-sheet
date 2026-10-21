// Окно листа персонажа: отрисовка, ввод, броски.

import OBR from "./obr.js";
import {
  ABILITIES, SKILLS, abilityModifier, proficiencyBonus, formatModifier, savingThrowBonus, skillBonus,
  initiativeBonus, passivePerception, applyDamage, applyHealing, toInt,
} from "./rules.js";
import { rollD20, rollFormula, critFormula } from "./dice.js";
import { createCharacter, createAttack, normalizeCharacter, MAX_ATTACKS } from "./character.js";
import { loadCharacter, scheduleSave, loadSettings, saveSettings, loadLog, saveLog } from "./storage.js";
import { sendRoll, describeDetail } from "./rolls.js";
import { initTheme } from "./theme.js";

const QUICK_DICE = [4, 6, 8, 10, 12, 20, 100];
const CRIT_DAMAGE_WINDOW_MS = 60_000;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let character = createCharacter();
let loaded = false;
let version = "";
const settings = loadSettings({ mode: "normal", hidden: false, showOnMap: true, tab: "sheet" });
const lastCritAt = new Map(); // id атаки → время последнего крита на попадание
const seenLogIds = new Set();
let unreadLog = 0;

/** Мини-конструктор DOM: h("div", { class: "x", onclick }, ...дети). Текст вставляется только как текст. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    if (key === "class") el.className = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => o?.[k], obj);
}

function setPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}

// ---------- Построение интерфейса ----------

function buildAbilities() {
  $("#abilities").replaceChildren(
    ...ABILITIES.map((a) =>
      h("div", { class: "ability" },
        h("div", { class: "ability-name" }, a.name),
        h("div", { class: "ability-score" },
          h("input", {
            type: "number", min: 1, max: 30, inputmode: "numeric", "aria-label": `${a.name}: значение`,
            dataset: { path: `abilities.${a.id}`, kind: "int" },
          }),
          h("button", {
            type: "button", class: "roll-btn", title: `Проверка: ${a.name}`, dataset: { out: `mod-${a.id}` },
            onclick: () => rollCheck(a.name, abilityModifier(character.abilities[a.id])),
          }),
        ),
        h("div", { class: "ability-save" },
          h("button", {
            type: "button", class: "prof", title: "Владение спасброском", "aria-label": `Владение спасброском: ${a.name}`,
            dataset: { saveProf: a.id },
          }),
          "Спас",
          h("button", {
            type: "button", class: "roll-btn", title: `Спасбросок: ${a.name}`, dataset: { out: `save-${a.id}` },
            onclick: () => rollCheck(`Спасбросок ${a.name}`, savingThrowBonus(character, a.id)),
          }),
        ),
      ),
    ),
  );
}

function buildSkills() {
  const shortName = Object.fromEntries(ABILITIES.map((a) => [a.id, a.short]));
  $("#skills").replaceChildren(
    ...SKILLS.map((s) =>
      h("div", { class: "skill" },
        h("button", {
          type: "button", class: "prof", "aria-label": `Владение навыком: ${s.name}`,
          dataset: { skillProf: s.id },
        }),
        h("span", { class: "skill-name", title: s.name }, s.name, " ", h("span", { class: "skill-ability" }, shortName[s.ability])),
        h("button", {
          type: "button", class: "roll-btn", title: `Проверка: ${s.name}`, dataset: { out: `skill-${s.id}` },
          onclick: () => rollCheck(s.name, skillBonus(character, s)),
        }),
      ),
    ),
  );
}

function buildQuickDice() {
  $("#quick-dice").replaceChildren(
    ...QUICK_DICE.map((sides) =>
      h("button", { type: "button", class: "roll-btn", onclick: () => rollDamage(`d${sides}`, `1d${sides}`) }, `d${sides}`),
    ),
  );
}

function renderAttacks() {
  const list = $("#attacks");
  if (!character.attacks.length) {
    list.replaceChildren(h("p", { class: "muted center" }, "Добавьте оружие или заклинание, чтобы бросать атаку и урон в один клик."));
  } else {
    list.replaceChildren(
      h("div", { class: "attacks-head" }, h("span", {}, "Название"), h("span", {}, "Бонус"), h("span", {}, "Урон")),
      ...character.attacks.map((atk) =>
        h("div", { class: "attack", dataset: { attackId: atk.id } },
          h("input", { type: "text", maxlength: 80, placeholder: "Длинный меч", "aria-label": "Название атаки", dataset: { attackField: "name" } }),
          h("input", { type: "number", min: -20, max: 30, inputmode: "numeric", "aria-label": "Бонус атаки", dataset: { attackField: "bonus" } }),
          h("input", { type: "text", maxlength: 40, placeholder: "1d8+3", "aria-label": "Формула урона", dataset: { attackField: "damage" } }),
          h("button", { type: "button", class: "roll-btn", title: "Бросок атаки", onclick: () => rollAttack(atk.id) }, "Атака"),
          h("button", { type: "button", class: "roll-btn", title: "Бросок урона (после крита — удвоенные кубики)", onclick: () => rollAttackDamage(atk.id) }, "Урон"),
          h("button", { type: "button", class: "remove", title: "Удалить", "aria-label": "Удалить атаку", onclick: () => removeAttack(atk.id) }, "×"),
        ),
      ),
    );
  }
  $("#add-attack").disabled = character.attacks.length >= MAX_ATTACKS;
  syncInputs();
}

// ---------- Синхронизация состояния и DOM ----------

/** Переносит значения из состояния в поля ввода (кроме поля, которое сейчас редактируют). */
function syncInputs() {
  for (const el of $$("[data-path]")) {
    if (el === document.activeElement) continue;
    el.value = getPath(character, el.dataset.path) ?? "";
  }
  for (const row of $$("[data-attack-id]")) {
    const atk = character.attacks.find((a) => a.id === row.dataset.attackId);
    if (!atk) continue;
    for (const el of $$("[data-attack-field]", row)) {
      if (el !== document.activeElement) el.value = atk[el.dataset.attackField];
    }
  }
}

function setOut(name, text) {
  const el = $(`[data-out="${name}"]`);
  if (el) el.textContent = text;
}

/** Пересчитывает все производные значения: модификаторы, бонусы, полоску хитов, переключатели. */
function refresh() {
  setOut("pb", formatModifier(proficiencyBonus(character.level)));
  for (const a of ABILITIES) {
    setOut(`mod-${a.id}`, formatModifier(abilityModifier(character.abilities[a.id])));
    setOut(`save-${a.id}`, formatModifier(savingThrowBonus(character, a.id)));
    const prof = $(`[data-save-prof="${a.id}"]`);
    prof.dataset.level = character.saves[a.id] ? 1 : 0;
    prof.setAttribute("aria-pressed", String(character.saves[a.id]));
  }
  for (const s of SKILLS) {
    setOut(`skill-${s.id}`, formatModifier(skillBonus(character, s)));
    const prof = $(`[data-skill-prof="${s.id}"]`);
    const level = character.skills[s.id];
    prof.dataset.level = level;
    prof.title = ["Нет владения", "Владение", "Компетентность"][level];
  }
  setOut("initiative", formatModifier(initiativeBonus(character)));
  setOut("passive", String(passivePerception(character)));

  const { current, max, temp } = character.hp;
  const fill = Math.min(100, (current / max) * 100);
  const fillEl = $('[data-out="hpFill"]');
  fillEl.style.width = `${fill}%`;
  fillEl.style.background = fill > 50 ? "var(--success)" : fill > 25 ? "var(--gold)" : "var(--danger)";
  const tempEl = $('[data-out="hpTemp"]');
  tempEl.style.left = `${fill}%`;
  tempEl.style.width = `${Math.min(100 - fill, (temp / max) * 100)}%`;

  for (const el of $$("[data-toggle]")) el.setAttribute("aria-pressed", String(Boolean(getPath(character, el.dataset.toggle))));
  for (const el of $$("[data-setting]")) el.setAttribute("aria-pressed", String(Boolean(settings[el.dataset.setting])));
  for (const el of $$("[data-mode]")) el.setAttribute("aria-checked", String(el.dataset.mode === settings.mode));
  for (const el of $$("[data-tab]")) el.setAttribute("aria-selected", String(el.dataset.tab === settings.tab));
  for (const el of $$("[data-panel]")) el.hidden = el.dataset.panel !== settings.tab;
}

function changed() {
  refresh();
  if (!loaded) return;
  setStatus("Сохранение…");
  scheduleSave(character, (ok) => setStatus(ok ? "Сохранено" : "Не удалось сохранить", !ok));
}

let errorShownUntil = 0;

/** Строка состояния в подвале. Ошибка держится несколько секунд и не затирается «Сохранено». */
function setStatus(text, isError = false) {
  if (!isError && Date.now() < errorShownUntil) return;
  if (isError) errorShownUntil = Date.now() + 4000;
  const el = $("#status");
  el.textContent = version ? `v${version} · ${text}` : text;
  el.classList.toggle("error", isError);
}

function setSettings(patch) {
  Object.assign(settings, patch);
  saveSettings(settings);
  refresh();
}

// ---------- Броски ----------

function showLastRoll(roll) {
  const el = $("#last-roll");
  el.hidden = false;
  el.className = `last-roll${roll.crit ? " crit" : roll.fumble ? " fumble" : ""}`;
  el.replaceChildren(
    `${roll.hidden ? "🔒 " : ""}${roll.label}:`,
    h("b", {}, String(roll.total)),
    h("span", { class: "muted" }, `  ${describeDetail(roll)}`),
  );
  el.style.animation = "none";
  void el.offsetWidth; // перезапуск анимации
  el.style.animation = "";
}

async function doRoll(payload) {
  const roll = { ...payload, hidden: settings.hidden, characterName: character.name.trim() };
  showLastRoll(roll);
  try {
    await sendRoll(roll, { showOnMap: settings.showOnMap });
  } catch (e) {
    console.error("[dnd-sheet] бросок не отправлен", e);
    setStatus("Бросок не отправлен другим игрокам", true);
  }
}

function rollCheck(label, modifier) {
  const r = rollD20(modifier, settings.mode);
  doRoll({ kind: "d20", label, modifier, mode: settings.mode, rolls: r.rolls, total: r.total, crit: r.crit, fumble: r.fumble });
  return r;
}

function rollDamage(label, formula) {
  try {
    const r = rollFormula(formula);
    doRoll({ kind: "formula", label, total: r.total, detail: `${formula}: ${r.text}`, crit: false, fumble: false });
    return true;
  } catch (e) {
    setStatus(e.message, true);
    return false;
  }
}

function attackName(atk) {
  return atk.name.trim() || "Атака";
}

function rollAttack(id) {
  const atk = character.attacks.find((a) => a.id === id);
  if (!atk) return;
  const r = rollCheck(attackName(atk), atk.bonus);
  if (r.crit) lastCritAt.set(id, Date.now());
  else lastCritAt.delete(id);
}

function rollAttackDamage(id) {
  const atk = character.attacks.find((a) => a.id === id);
  if (!atk) return;
  const crit = Date.now() - (lastCritAt.get(id) ?? 0) < CRIT_DAMAGE_WINDOW_MS;
  lastCritAt.delete(id);
  try {
    const formula = crit ? critFormula(atk.damage) : atk.damage;
    rollDamage(`${attackName(atk)} — урон${crit ? " (крит ×2)" : ""}`, formula);
  } catch (e) {
    setStatus(e.message, true);
  }
}

function removeAttack(id) {
  character.attacks = character.attacks.filter((a) => a.id !== id);
  renderAttacks();
  changed();
}

// ---------- Журнал ----------

function renderLog() {
  const log = loadLog();
  const fresh = log.filter((r) => !seenLogIds.has(r.id));
  fresh.forEach((r) => seenLogIds.add(r.id));
  if (settings.tab !== "log") unreadLog += fresh.length;
  const badge = $("#log-badge");
  badge.hidden = unreadLog === 0;
  badge.textContent = String(unreadLog);

  $("#log-empty").hidden = log.length > 0;
  $("#clear-log").hidden = log.length === 0;
  $("#log").replaceChildren(
    ...log.map((r) => {
      const who = r.characterName || r.playerName || "Герой";
      const time = new Date(r.time).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      const li = h("li", { class: r.crit ? "crit" : r.fumble ? "fumble" : "" },
        h("span", { class: "who" }, `${r.hidden ? "🔒 " : ""}${who} · ${r.label}`),
        h("span", { class: "total" }, String(r.total)),
        h("span", { class: "detail" }, `${describeDetail(r)} · ${time}`),
      );
      if (/^#[0-9a-f]{3,8}$/i.test(r.playerColor ?? "")) li.style.setProperty("--player", r.playerColor);
      return li;
    }),
  );
}

// ---------- Резервная копия ----------

function openBackup() {
  $("#backup-text").value = JSON.stringify(character, null, 2);
  $("#backup-error").hidden = true;
  resetConfirm(false);
  $("#backup").showModal();
}

function importBackup() {
  const error = $("#backup-error");
  try {
    const data = JSON.parse($("#backup-text").value);
    if (!data || typeof data !== "object") throw new Error();
    replaceCharacter(normalizeCharacter(data));
    $("#backup").close();
  } catch {
    error.textContent = "Это не похоже на сохранённый лист. Проверьте, что текст скопирован целиком.";
    error.hidden = false;
  }
}

function downloadBackup() {
  const blob = new Blob([JSON.stringify(character, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: `${character.name.trim() || "персонаж"}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let confirmReset = false;
function resetConfirm(state) {
  confirmReset = state;
  $("#reset-sheet").textContent = state ? "Точно очистить?" : "Очистить лист";
}

function replaceCharacter(next) {
  character = next;
  lastCritAt.clear();
  renderAttacks();
  syncInputs();
  changed();
}

// ---------- События ----------

function bindEvents() {
  document.addEventListener("input", (e) => {
    const el = e.target;
    if (el.dataset.path) {
      if (el.dataset.kind === "int") {
        const n = toInt(el.value, NaN);
        if (Number.isNaN(n)) return; // пустое поле — ждём, пока пользователь допишет
        setPath(character, el.dataset.path, n);
      } else {
        setPath(character, el.dataset.path, el.value);
      }
      changed();
    } else if (el.dataset.attackField) {
      const atk = character.attacks.find((a) => a.id === el.closest("[data-attack-id]").dataset.attackId);
      if (!atk) return;
      const field = el.dataset.attackField;
      if (field === "bonus") {
        const n = toInt(el.value, NaN);
        if (Number.isNaN(n)) return;
        atk.bonus = n;
      } else {
        atk[field] = el.value;
      }
      changed();
    }
  });

  // По окончании ввода приводим значения к допустимым и показываем исправленные.
  document.addEventListener("change", (e) => {
    if (!e.target.dataset.path && !e.target.dataset.attackField) return;
    character = normalizeCharacter(character);
    syncInputs();
    changed();
  });

  document.addEventListener("click", (e) => {
    const el = e.target.closest("button");
    if (!el) return;
    const { saveProf, skillProf, toggle, setting, mode, tab } = el.dataset;
    if (saveProf) {
      character.saves[saveProf] = !character.saves[saveProf];
      changed();
    } else if (skillProf) {
      character.skills[skillProf] = (character.skills[skillProf] + 1) % 3;
      changed();
    } else if (toggle) {
      setPath(character, toggle, !getPath(character, toggle));
      changed();
    } else if (setting) {
      setSettings({ [setting]: !settings[setting] });
    } else if (mode) {
      setSettings({ mode });
    } else if (tab) {
      if (tab === "log") unreadLog = 0;
      setSettings({ tab });
      renderLog();
    }
  });

  $("#roll-initiative").addEventListener("click", () => rollCheck("Инициатива", initiativeBonus(character)));

  const hpAmount = $("#hp-amount");
  const changeHp = (fn) => {
    const amount = toInt(hpAmount.value, 0);
    if (amount <= 0) return hpAmount.focus();
    character.hp = fn(character.hp, amount);
    hpAmount.value = "";
    syncInputs();
    changed();
  };
  $("#hp-damage").addEventListener("click", () => changeHp(applyDamage));
  $("#hp-heal").addEventListener("click", () => changeHp(applyHealing));

  $("#add-attack").addEventListener("click", () => {
    if (character.attacks.length >= MAX_ATTACKS) return;
    character.attacks.push(createAttack());
    renderAttacks();
    $("#attacks .attack:last-child input")?.focus();
    changed();
  });

  $("#free-roll").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#free-formula");
    if (rollDamage("Бросок", input.value.trim())) input.select();
  });

  $("#clear-log").addEventListener("click", () => {
    saveLog([]);
    renderLog();
  });

  $("#open-backup").addEventListener("click", openBackup);
  $("#import-backup").addEventListener("click", importBackup);
  $("#download-backup").addEventListener("click", downloadBackup);
  $("#reset-sheet").addEventListener("click", () => {
    if (!confirmReset) return resetConfirm(true);
    replaceCharacter(createCharacter());
    $("#backup").close();
  });

  // Журнал пишет фоновая страница (другой документ) — узнаём об изменениях через событие storage.
  window.addEventListener("storage", (e) => {
    if (e.key?.startsWith("dnd-sheet:log:")) renderLog();
  });
  window.addEventListener("dnd-sheet:log", renderLog);
}

// ---------- Запуск ----------

async function start() {
  buildAbilities();
  buildSkills();
  buildQuickDice();
  bindEvents();
  refresh();

  if (OBR.isAvailable) {
    await new Promise((resolve) => OBR.onReady(resolve));
    await initTheme();
    OBR.action.setBadgeText(undefined).catch(() => {});
  }

  character = await loadCharacter();
  loaded = true;
  renderAttacks();
  syncInputs();
  refresh();
  loadLog().forEach((r) => seenLogIds.add(r.id));
  renderLog();

  try {
    version = (await (await fetch("manifest.json", { cache: "no-cache" })).json()).version;
  } catch {
    version = "";
  }
  setStatus(OBR.isAvailable ? "Готово" : "Режим без Owlbear: броски видны только вам");
}

start().catch((e) => {
  console.error("[dnd-sheet] ошибка запуска", e);
  setStatus("Ошибка запуска — откройте консоль браузера", true);
});
