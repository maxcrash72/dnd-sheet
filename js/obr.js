// Единственное место, где подключается SDK Owlbear Rodeo. Версия закреплена:
// при обновлении SDK меняйте её только здесь и проверяйте плагин.
export { default, buildLabel } from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3.1.0/+esm";

// Префикс всех ключей метаданных и каналов плагина (обратная доменная нотация, как советует OBR).
export const PLUGIN_ID = "io.github.maxcrash72.dnd-sheet";
