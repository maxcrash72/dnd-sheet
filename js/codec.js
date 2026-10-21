// Упаковка листа для хранения в метаданных комнаты Owlbear (лимит — 16 КБ на всю комнату):
// JSON → deflate → base64. Без DOM и SDK, работает и в браузере, и в Node.

const PREFIX = "z1:";

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Упаковывает объект в строку. */
export async function encodeSheet(value) {
  const json = new TextEncoder().encode(JSON.stringify(value));
  return PREFIX + toBase64(await pipe(json, new CompressionStream("deflate")));
}

/** Распаковывает строку из encodeSheet; бросает Error, если данные повреждены. */
export async function decodeSheet(text) {
  if (typeof text !== "string" || !text.startsWith(PREFIX)) throw new Error("Неизвестный формат листа");
  const bytes = await pipe(fromBase64(text.slice(PREFIX.length)), new DecompressionStream("deflate"));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Размер значения в метаданных в байтах (так его считает лимит Owlbear). */
export function metadataSize(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
