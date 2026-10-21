// Подмена SDK Owlbear Rodeo для ручной проверки без Owlbear (см. dev/harness.html).
// Метаданные комнаты общие для всех вкладок этого браузера — можно открыть игрока и мастера рядом.
// Параметры адреса: ?player=<id>&name=<имя>&role=GM|PLAYER

const params = new URLSearchParams(location.search);
const ROOM_KEY = "obr-mock:room-metadata";
const bus = new BroadcastChannel("obr-mock");
const listeners = { room: new Set(), broadcast: new Map() };

function readRoom() {
  try {
    return JSON.parse(localStorage.getItem(ROOM_KEY)) ?? {};
  } catch {
    return {};
  }
}

function emitRoom() {
  const metadata = readRoom();
  listeners.room.forEach((cb) => cb(metadata));
}

bus.onmessage = ({ data }) => {
  if (data.type === "room") emitRoom();
  if (data.type === "broadcast") listeners.broadcast.get(data.channel)?.forEach((cb) => cb({ data: data.data, connectionId: "other" }));
};

const player = {
  id: params.get("player") ?? "player-1",
  name: params.get("name") ?? "Игрок",
  role: params.get("role") === "GM" ? "GM" : "PLAYER",
  metadata: {},
};

const OBR = {
  isAvailable: true,
  isReady: true,
  onReady: (cb) => cb(),
  player: {
    get id() {
      return player.id;
    },
    getName: async () => player.name,
    getRole: async () => player.role,
    getColor: async () => "#58a6ff",
    getSelection: async () => [],
    getMetadata: async () => player.metadata,
    setMetadata: async (update) => Object.assign(player.metadata, update),
    onChange: () => () => {},
  },
  room: {
    id: "mock-room",
    getMetadata: async () => readRoom(),
    setMetadata: async (update) => {
      const next = { ...readRoom(), ...update };
      for (const [k, v] of Object.entries(update)) if (v === undefined) delete next[k];
      const size = new TextEncoder().encode(JSON.stringify(next)).length;
      if (size > 16 * 1024) throw new Error(`Room metadata over 16kB (${size})`);
      localStorage.setItem(ROOM_KEY, JSON.stringify(next));
      emitRoom();
      bus.postMessage({ type: "room" });
    },
    onMetadataChange: (cb) => {
      listeners.room.add(cb);
      return () => listeners.room.delete(cb);
    },
  },
  theme: {
    getTheme: async () => ({
      mode: "DARK",
      primary: { main: "#bb99ff", light: "#c9adff", dark: "#8c73bf", contrastText: "#1b1b1b" },
      secondary: { main: "#ee99ff", light: "#f1adff", dark: "#b373bf", contrastText: "#1b1b1b" },
      background: { default: "#1e2231", paper: "#222639" },
      text: { primary: "#ffffff", secondary: "rgba(255, 255, 255, 0.7)", disabled: "rgba(255, 255, 255, 0.5)" },
    }),
    onChange: () => () => {},
  },
  action: {
    setBadgeText: async () => {},
    isOpen: async () => true,
    onOpenChange: () => () => {},
  },
  notification: { show: async (text) => console.info("[obr-mock] notification:", text) },
  scene: { isReady: async () => false },
  broadcast: {
    sendMessage: async (channel, data) => {
      listeners.broadcast.get(channel)?.forEach((cb) => cb({ data, connectionId: "self" }));
      bus.postMessage({ type: "broadcast", channel, data });
    },
    onMessage: (channel, cb) => {
      if (!listeners.broadcast.has(channel)) listeners.broadcast.set(channel, new Set());
      listeners.broadcast.get(channel).add(cb);
      return () => listeners.broadcast.get(channel).delete(cb);
    },
  },
};

export default OBR;
export function buildLabel() {
  throw new Error("buildLabel is not available in obr-mock");
}
