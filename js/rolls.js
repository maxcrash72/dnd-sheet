// Рассылка бросков и их показ. Отправляет окно листа, показывает фоновая страница каждого игрока.

import OBR, { buildLabel, PLUGIN_ID } from "./obr.js";
import { formatModifier } from "./rules.js";
import { loadLog, saveLog } from "./storage.js";

export const ROLL_CHANNEL = `${PLUGIN_ID}/roll`;
const LABEL_TTL_MS = 6000;
const LOG_LIMIT = 50;

const COLORS = {
  crit: { bg: "#f5c542", fg: "#1b1b1b" },
  fumble: { bg: "#b3261e", fg: "#ffffff" },
};

/** Однострочное описание броска для уведомления и надписи на карте. */
export function describeRoll(roll) {
  const who = roll.characterName || roll.playerName || "Герой";
  const flag = roll.crit ? " — КРИТ!" : roll.fumble ? " — провал!" : "";
  return `${who} · ${roll.label}: ${roll.total}${flag}`;
}

/** Подробности: выпавшие кубики и модификатор, например «[12, 7] +5 (преим.)». */
export function describeDetail(roll) {
  if (roll.kind === "formula") return roll.detail;
  const mode = roll.mode === "advantage" ? " (преим.)" : roll.mode === "disadvantage" ? " (помеха)" : "";
  const mod = roll.modifier ? ` ${formatModifier(roll.modifier)}` : "";
  return `[${roll.rolls.join(", ")}]${mod}${mode}`;
}

/** Точка на карте для надписи: над выделенным токеном или в центре экрана отправителя. */
async function findAnchor() {
  if (!(await OBR.scene.isReady())) return null;
  const selection = await OBR.player.getSelection();
  if (selection?.length) {
    const bounds = await OBR.scene.items.getItemBounds(selection);
    return { x: bounds.center.x, y: bounds.min.y };
  }
  const [width, height] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
  return OBR.viewport.inverseTransformPoint({ x: width / 2, y: height / 2 });
}

/** Отправляет бросок всем игрокам комнаты (включая себя). */
export async function sendRoll(roll, { showOnMap }) {
  const message = { ...roll, id: crypto.randomUUID(), time: Date.now() };
  if (!OBR.isAvailable) {
    // Вне Owlbear (локальная отладка) — показываем бросок только у себя.
    appendToLog(message);
    return message;
  }
  message.playerId = OBR.player.id;
  message.playerName = await OBR.player.getName();
  message.playerColor = await OBR.player.getColor();
  if (showOnMap) {
    try {
      message.anchor = await findAnchor();
    } catch (e) {
      console.warn("[dnd-sheet] не удалось определить точку на карте", e);
    }
  }
  await OBR.broadcast.sendMessage(ROLL_CHANNEL, message, { destination: "ALL" });
  return message;
}

/** Обработка полученного броска (вызывается фоновой страницей). Возвращает true, если бросок показан. */
export async function receiveRoll(roll, { myId, myRole }) {
  if (roll.hidden && roll.playerId !== myId && myRole !== "GM") return false;
  appendToLog(roll);
  const text = (roll.hidden ? "🔒 " : "") + describeRoll(roll);
  const variant = roll.crit ? "SUCCESS" : roll.fumble ? "ERROR" : "DEFAULT";
  OBR.notification.show(`${text}  ${describeDetail(roll)}`, variant).catch(() => {});
  if (roll.anchor && !roll.hidden) {
    await showLabel(roll, text).catch((e) => console.warn("[dnd-sheet] не удалось показать надпись", e));
  }
  return true;
}

async function showLabel(roll, text) {
  if (!(await OBR.scene.isReady())) return;
  const colors = roll.crit ? COLORS.crit : roll.fumble ? COLORS.fumble : { bg: roll.playerColor || "#3d4051", fg: "#ffffff" };
  const label = buildLabel()
    .plainText(text)
    .position(roll.anchor)
    .pointerDirection("DOWN")
    .pointerHeight(10)
    .pointerWidth(14)
    .backgroundColor(colors.bg)
    .backgroundOpacity(0.92)
    .fillColor(colors.fg)
    .fontSize(22)
    .fontWeight(700)
    .padding(10)
    .cornerRadius(10)
    .layer("TEXT")
    .locked(true)
    .disableHit(true)
    .build();
  // Локальный объект: виден только этому игроку, не попадает в сцену и историю отмен,
  // поэтому не остаётся «навсегда», даже если что-то пойдёт не так.
  await OBR.scene.local.addItems([label]);
  setTimeout(() => OBR.scene.local.deleteItems([label.id]).catch(() => {}), LABEL_TTL_MS);
}

export function appendToLog(roll) {
  const log = loadLog();
  if (log.some((r) => r.id === roll.id)) return;
  log.unshift(roll);
  saveLog(log.slice(0, LOG_LIMIT));
  window.dispatchEvent(new CustomEvent("dnd-sheet:log"));
}
