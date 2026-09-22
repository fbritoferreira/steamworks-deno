import type { SteamApiJson } from "../schema.ts";
import type { LayoutResolver } from "../layout.ts";

/** Sizes and offsets for both packings, consumed by the C layout harness test. */
export function emitLayoutJson(schema: SteamApiJson, resolver: LayoutResolver): string {
  const pack: Record<string, Record<string, { size: number; fields: Record<string, number> }>> = {
    "4": {},
    "8": {},
  };
  for (const p of [4, 8] as const) {
    for (const s of [...schema.structs, ...schema.callback_structs]) {
      const l = resolver.layout(s.struct, p);
      pack[String(p)][s.struct] = {
        size: l.size,
        fields: Object.fromEntries(l.fields.map((f) => [f.name, f.offset])),
      };
    }
  }
  return JSON.stringify({ pack }, null, 1) + "\n";
}
