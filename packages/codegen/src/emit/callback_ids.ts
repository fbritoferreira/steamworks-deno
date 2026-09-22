import type { SteamApiJson } from "../schema.ts";

const strip = (s: string) => s.replace(/_t$/, "");

/** `CallbackId` name to id, and a decoder table keyed by id. */
export function emitCallbackIds(schema: SteamApiJson): string {
  const sorted = [...schema.callback_structs].sort((a, b) => a.callback_id - b.callback_id);
  const seen = new Set<number>();
  const unique = sorted.filter((c) => !seen.has(c.callback_id) && seen.add(c.callback_id));
  const names = unique.map((c) => `  ${strip(c.struct)}: ${c.callback_id},`).join("\n");
  const decoders = unique.map((c) => `  ${c.callback_id}: decode${c.struct},`).join("\n");
  const imports = unique.map((c) => `  decode${c.struct},`).join("\n");
  return `import {\n${imports}\n} from "./structs.ts";\n\n` +
    `/** Callback ids from steam_api.json, keyed by struct name without its _t suffix. */\n` +
    `export const CallbackId = {\n${names}\n} as const;\n\n` +
    `/** Decoder for each callback id, for dispatching a raw callback payload. */\n` +
    `export const CallbackDecoders: Record<number, (bytes: Uint8Array) => unknown> = {\n${decoders}\n};\n`;
}
