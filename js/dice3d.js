// Связь с расширением «Dice (dnd-sheet)» (https://github.com/maxcrash72/dnd-dice):
// настоящие 3D-кубики с физикой. Расширения общаются через BroadcastChannel —
// это работает, потому что оба лежат на одном адресе maxcrash72.github.io.

const API_CHANNEL = "io.github.maxcrash72.dnd-dice/api";
const PING_TIMEOUT_MS = 1500;
const ROLL_TIMEOUT_MS = 30000;

export const DICE_STYLES = [
  { id: "GALAXY", name: "Галактика" },
  { id: "GEMSTONE", name: "Самоцвет" },
  { id: "GLASS", name: "Стекло" },
  { id: "IRON", name: "Железо" },
  { id: "NEBULA", name: "Туманность" },
  { id: "SUNRISE", name: "Рассвет" },
  { id: "SUNSET", name: "Закат" },
  { id: "WALNUT", name: "Орех" },
];

const pending = new Map();
let channel = null;

function getChannel() {
  if (channel || !globalThis.BroadcastChannel) return channel;
  channel = new BroadcastChannel(API_CHANNEL);
  channel.onmessage = ({ data }) => {
    const waiter = data && pending.get(data.id);
    if (!waiter) return;
    if (data.type === "pong" || data.type === "result") waiter.resolve(data);
    else if (data.type === "error") waiter.reject(new Error(data.message));
  };
  return channel;
}

function request(message, timeoutMs) {
  const ch = getChannel();
  if (!ch) return Promise.reject(new Error("BroadcastChannel недоступен"));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Расширение Dice не ответило"));
    }, timeoutMs);
    const done = (fn) => (value) => {
      clearTimeout(timer);
      pending.delete(id);
      fn(value);
    };
    pending.set(id, { resolve: done(resolve), reject: done(reject) });
    ch.postMessage({ ...message, id });
  });
}

/** true, если расширение Dice (dnd-sheet) установлено в комнате и отвечает. */
export async function detectDice3d() {
  try {
    await request({ type: "ping" }, PING_TIMEOUT_MS);
    return true;
  } catch {
    return false;
  }
}

/**
 * Бросает кубики в 3D. roll — формат API: { dice: ["D20", ...], combination?, bonus? }.
 * Возвращает { total, values } — значения верхнего уровня в порядке запроса.
 */
export function roll3d(roll, { hidden = false, style } = {}) {
  return request({ type: "roll", roll, hidden, style }, ROLL_TIMEOUT_MS);
}
