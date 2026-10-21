// Фоновая страница: работает у каждого игрока, пока открыта комната, даже если лист закрыт.
// Принимает броски, пишет их в журнал, показывает уведомление и надпись на карте,
// а пока лист закрыт — считает новые броски на значке кнопки плагина.

import OBR from "./obr.js";
import { ROLL_CHANNEL, receiveRoll } from "./rolls.js";

let unread = 0;

function setBadge(count) {
  unread = count;
  OBR.action.setBadgeText(count ? String(count) : undefined).catch(() => {});
}

OBR.onReady(() => {
  OBR.action.onOpenChange((isOpen) => {
    if (isOpen) setBadge(0);
  });

  OBR.broadcast.onMessage(ROLL_CHANNEL, async ({ data }) => {
    if (!data || typeof data !== "object") return;
    try {
      const myRole = await OBR.player.getRole();
      const shown = await receiveRoll(data, { myId: OBR.player.id, myRole });
      if (shown && data.playerId !== OBR.player.id && !(await OBR.action.isOpen())) setBadge(unread + 1);
    } catch (e) {
      console.error("[dnd-sheet] ошибка при показе броска", e);
    }
  });
});
