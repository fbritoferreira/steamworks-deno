import type { SteamApiJson } from "../schema.ts";
import { mapType, type TypeContext } from "../types.ts";
import { evalConst } from "../constval.ts";

/**
 * Constants from the schema. 64-bit ones are emitted as bigint literals so they
 * compare equal to values that cross the FFI boundary.
 */
export function emitConsts(schema: SteamApiJson, ctx: TypeContext): string {
  const out: string[] = [];
  for (const c of schema.consts) {
    let type;
    try {
      type = mapType(c.consttype, ctx);
    } catch {
      out.push(`// ${c.constname}: unknown type ${c.consttype}`);
      continue;
    }
    const width = type.size * 8 || 32;
    let value: bigint;
    try {
      value = evalConst(c.constval, width);
    } catch {
      out.push(`// ${c.constname} = ${c.constval} (expression not understood)`);
      continue;
    }
    if (type.kind === "float") {
      out.push(`export const ${c.constname} = ${Number(value)};`);
    } else if (type.kind === "bigint") {
      out.push(`export const ${c.constname} = ${value}n;`);
    } else {
      out.push(`export const ${c.constname} = ${value};`);
    }
  }
  return out.join("\n") + "\n";
}
