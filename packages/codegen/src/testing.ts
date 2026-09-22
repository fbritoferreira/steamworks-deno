/** Helpers shared by the codegen tests. */
import type { SteamApiJson } from "./schema.ts";
import type { PackMode } from "./packscan.ts";

/**
 * Mark every struct as living in the VALVE_CALLBACK_PACK region, which is where the
 * callback structs used in tests actually sit. Structs with their own packing are
 * covered by `packscan_test.ts`.
 */
export function platformPacking(schema: SteamApiJson): Map<string, PackMode> {
  const m = new Map<string, PackMode>();
  for (const s of [...schema.structs, ...schema.callback_structs]) m.set(s.struct, "platform");
  return m;
}
