// Окно листа персонажа: отрисовка, ввод, броски.

import OBR from "./obr.js";
import {
  ABILITIES, SKILLS, MAX_ADVANTAGE, abilityModifier, formatModifier, savingThrowBonus, skillBonus,
  initiativeBonus, advantageLabel, spendPool, restorePool, clamp, toInt,
} from "./rules.js";
import {
  rollD20, d20FromRolls, d20Request, parseFormula, rollFormula, formulaFromValues, formulaRequest,
} from "./dice.js";
import { detectDice3d, roll3d, DICE_STYLES } from "./dice3d.js";
import {
  createCharacter, createAttack, createResource, normalizeCharacter, MAX_ATTACKS, MAX_RESOURCES,
} from "./character.js";
import { loadCharacter, scheduleSave, loadSettings, saveSettings, loadLog, saveLog } from "./storage.js";
import { sendRoll, describeDetail } from "./rolls.js";
import { initTheme } from "./theme.js";

const QUICK_DICE = [4, 6, 8, 10, 12, 20, 100];
const DICE_3D_RETRY_MS = 30_000;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let character = createCharacter();
let loaded = false;
let version = "";
let dice3dAvailable = false;
const settings = loadSettings({
  advantage: 0, hidden: false, showOnMap: true, use3d: true, diceStyle: DICE_STYLES[0].id, tab: "sheet",
});
settings.advantage = clamp(toInt(settings.advantage, 0), -MAX_ADVANTAGE, MAX_ADVANTAGE);
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
          "Спасбросок",
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
  $("#dice-style").replaceChildren(...DICE_STYLES.map((s) => h("option", { value: s.id }, s.name)));
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
          h("button", { type: "button", class: "roll-btn", title: "Бросок урона", onclick: () => rollAttackDamage(atk.id) }, "Урон"),
          h("button", { type: "button", class: "remove", title: "Удалить", "aria-label": "Удалить атаку", onclick: () => removeAttack(atk.id) }, "×"),
        ),
      ),
    );
  }
  $("#add-attack").disabled = character.attacks.length >= MAX_ATTACKS;
  syncInputs();
}

function renderResources() {
  $("#resources").replaceChildren(
    ...character.resources.map((res) =>
      h("div", { class: "pool resource", dataset: { resourceId: res.id } },
        h("div", { class: "resource-head" },
          h("input", { type: "text", maxlength: 40, placeholder: "Мана", "aria-label": "Название ресурса", dataset: { resourceField: "name" } }),
          h("button", { type: "button", class: "remove", title: "Удалить", "aria-label": "Удалить ресурс", onclick: () => removeResource(res.id) }, "×"),
        ),
        h("div", { class: "bar" }, h("div", { class: "bar-fill", dataset: { resourceFill: res.id } })),
        h("div", { class: "resource-row" },
          h("input", { type: "number", min: 0, inputmode: "numeric", "aria-label": "Текущее значение", dataset: { resourceField: "current" } }),
          h("span", { class: "of" }, "из"),
          h("input", { type: "number", min: 1, inputmode: "numeric", "aria-label": "Максимум", dataset: { resourceField: "max" } }),
          h("span", { class: "spacer" }),
          h("button", { type: "button", class: "btn", title: "Потратить 1", onclick: () => changeResource(res.id, spendPool) }, "−1"),
          h("button", { type: "button", class: "btn", title: "Восстановить 1", onclick: () => changeResource(res.id, restorePool) }, "+1"),
        ),
      ),
    ),
  );
  $("#add-resource").disabled = character.resources.length >= MAX_RESOURCES;
  syncInputs();
}

// ---------- Синхронизация состояния и DOM ----------

/** Переносит значения из состояния в поля ввода (кроме поля, которое сейчас редактируют). */
function syncInputs() {
  for (const el of $$("[data-path]")) {
    if (el === document.activeElement) continue;
    el.value = getPath(character, el.dataset.path) ?? "";
  }
  syncRows("attackId", "attackField", character.attacks);
  syncRows("resourceId", "resourceField", character.resources);
}

function syncRows(idKey, fieldKey, items) {
  const fieldAttr = fieldKey.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  for (const row of $$(`[data-${idKey.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`)) {
    const item = items.find((i) => i.id === row.dataset[idKey]);
    if (!item) continue;
    for (const el of $$(`[data-${fieldAttr}]`, row)) {
      if (el !== document.activeElement) el.value = item[el.dataset[fieldKey]];
    }
  }
}

function setOut(name, text) {
  const el = $(`[data-out="${name}"]`);
  if (el) el.textContent = text;
}

function fillBar(el, pool, colored) {
  const fill = Math.min(100, (pool.current / pool.max) * 100);
  el.style.width = `${fill}%`;
  if (colored) el.style.background = fill > 50 ? "var(--success)" : fill > 25 ? "var(--gold)" : "var(--danger)";
}

/** Пересчитывает все производные значения: модификаторы, полоски, переключатели. */
function refresh() {
  for (const a of ABILITIES) {
    setOut(`mod-${a.id}`, formatModifier(abilityModifier(character.abilities[a.id])));
    setOut(`save-${a.id}`, formatModifier(savingThrowBonus(character, a.id)));
  }
  for (const s of SKILLS) setOut(`skill-${s.id}`, formatModifier(skillBonus(character, s)));
  setOut("initiative", formatModifier(initiativeBonus(character)));

  fillBar($('[data-out="hpFill"]'), character.hp, true);
  for (const res of character.resources) {
    const el = $(`[data-resource-fill="${res.id}"]`);
    if (el) fillBar(el, res, false);
  }

  const adv = settings.advantage;
  $("#adv-label").textContent = advantageLabel(adv);
  $(".stepper").dataset.state = adv > 0 ? "advantage" : adv < 0 ? "disadvantage" : "normal";
  $("#adv-down").disabled = adv <= -MAX_ADVANTAGE;
  $("#adv-up").disabled = adv >= MAX_ADVANTAGE;

  for (const el of $$("[data-setting]")) el.setAttribute("aria-pressed", String(Boolean(settings[el.dataset.setting])));
  const toggle3d = $("#toggle-3d");
  toggle3d.disabled = !dice3dAvailable;
  toggle3d.title = dice3dAvailable
    ? "3D-кубики через расширение Dice (dnd-sheet)"
    : "3D-кубики: установите в комнату расширение Dice (dnd-sheet)";
  if (!dice3dAvailable) toggle3d.setAttribute("aria-pressed", "false");
  $("#dice-style-field").hidden = !dice3dAvailable;
  $("#dice-style").value = settings.diceStyle;

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

function showRolling(label) {
  const el = $("#last-roll");
  el.hidden = false;
  el.className = "last-roll";
  el.replaceChildren(`🎲 ${label}: кубики катятся…`);
}

function use3d() {
  return settings.use3d && dice3dAvailable;
}

/** Бросок 3D-кубиками; при любой ошибке возвращает null, и бросок делается встроенным генератором. */
async function tryRoll3d(label, request) {
  if (!use3d() || !request) return null;
  showRolling(label);
  try {
    return await roll3d(request, { hidden: settings.hidden, style: settings.diceStyle });
  } catch (e) {
    console.warn("[dnd-sheet] 3D-бросок не удался", e);
    setStatus(`3D-кубики: ${e.message}. Бросок сделан без них`, true);
    return null;
  }
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

async function rollCheck(label, modifier) {
  const advantage = settings.advantage;
  const result3d = await tryRoll3d(label, d20Request(modifier, advantage));
  const r = result3d ? d20FromRolls(result3d.values, modifier, advantage) : rollD20(modifier, advantage);
  doRoll({
    kind: "d20", label, modifier, advantage, rolls: r.rolls, total: r.total, crit: r.crit, fumble: r.fumble,
    dice3d: Boolean(result3d),
  });
  return r;
}

async function rollDamage(label, formula) {
  let terms;
  try {
    terms = parseFormula(formula);
  } catch (e) {
    setStatus(e.message, true);
    return false;
  }
  const result3d = await tryRoll3d(label, formulaRequest(terms));
  const r = result3d ? formulaFromValues(terms, result3d.values) : rollFormula(formula);
  doRoll({
    kind: "formula", label, total: r.total, detail: `${formula}: ${r.text}`, crit: false, fumble: false,
    dice3d: Boolean(result3d),
  });
  return true;
}

function attackName(atk) {
  return atk.name.trim() || "Атака";
}

function rollAttack(id) {
  const atk = character.attacks.find((a) => a.id === id);
  if (atk) rollCheck(attackName(atk), atk.bonus);
}

function rollAttackDamage(id) {
  const atk = character.attacks.find((a) => a.id === id);
  if (atk) rollDamage(`${attackName(atk)} — урон`, atk.damage);
}

function removeAttack(id) {
  character.attacks = character.attacks.filter((a) => a.id !== id);
  renderAttacks();
  changed();
}

function removeResource(id) {
  character.resources = character.resources.filter((r) => r.id !== id);
  renderResources();
  changed();
}

function changeResource(id, fn) {
  const index = character.resources.findIndex((r) => r.id === id);
  if (index < 0) return;
  character.resources[index] = fn(character.resources[index], 1);
  syncInputs();
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
  renderAttacks();
  renderResources();
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
      return;
    }
    const field = el.dataset.attackField ?? el.dataset.resourceField;
    if (!field) return;
    const [items, rowAttr] = el.dataset.attackField
      ? [character.attacks, "attackId"]
      : [character.resources, "resourceId"];
    const row = el.closest(el.dataset.attackField ? "[data-attack-id]" : "[data-resource-id]");
    const item = items.find((i) => i.id === row?.dataset[rowAttr]);
    if (!item) return;
    if (el.type === "number") {
      const n = toInt(el.value, NaN);
      if (Number.isNaN(n)) return;
      item[field] = n;
    } else {
      item[field] = el.value;
    }
    changed();
  });

  // По окончании ввода приводим значения к допустимым и показываем исправленные.
  document.addEventListener("change", (e) => {
    const d = e.target.dataset;
    if (!d.path && !d.attackField && !d.resourceField) return;
    character = normalizeCharacter(character);
    syncInputs();
    changed();
  });

  document.addEventListener("click", (e) => {
    const el = e.target.closest("button");
    if (!el) return;
    const { setting, tab } = el.dataset;
    if (setting) {
      setSettings({ [setting]: !settings[setting] });
    } else if (tab) {
      if (tab === "log") unreadLog = 0;
      setSettings({ tab });
      renderLog();
    }
  });

  $("#adv-down").addEventListener("click", () => setSettings({ advantage: Math.max(-MAX_ADVANTAGE, settings.advantage - 1) }));
  $("#adv-up").addEventListener("click", () => setSettings({ advantage: Math.min(MAX_ADVANTAGE, settings.advantage + 1) }));
  $("#dice-style").addEventListener("change", (e) => setSettings({ diceStyle: e.target.value }));

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
  $("#hp-damage").addEventListener("click", () => changeHp(spendPool));
  $("#hp-heal").addEventListener("click", () => changeHp(restorePool));

  $("#add-attack").addEventListener("click", () => {
    if (character.attacks.length >= MAX_ATTACKS) return;
    character.attacks.push(createAttack());
    renderAttacks();
    $("#attacks .attack:last-child input")?.focus();
    changed();
  });

  $("#add-resource").addEventListener("click", () => {
    if (character.resources.length >= MAX_RESOURCES) return;
    character.resources.push(createResource());
    renderResources();
    $("#resources .resource:last-child input")?.focus();
    changed();
  });

  $("#free-roll").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#free-formula");
    if (await rollDamage("Бросок", input.value.trim())) input.select();
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

/** Ищет расширение с 3D-кубиками; пока не найдено — повторяет время от времени. */
async function watchDice3d() {
  dice3dAvailable = await detectDice3d();
  refresh();
  if (!dice3dAvailable) setTimeout(watchDice3d, DICE_3D_RETRY_MS);
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
  renderResources();
  syncInputs();
  refresh();
  loadLog().forEach((r) => seenLogIds.add(r.id));
  renderLog();
  watchDice3d();

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
