import type { Enum, SteamApiJson } from "../schema.ts";
import type { DocIndex } from "../docscan.ts";
import { jsdoc } from "./jsdoc.ts";

function emitOne(e: Enum, docs?: DocIndex): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const v of e.values) {
    // Valve gives some enums duplicate members (aliases). TypeScript rejects a repeated key.
    if (seen.has(v.name)) continue;
    seen.add(v.name);
    lines.push(`  ${v.name} = ${v.value},`);
  }
  const doc = docs?.enums.get(e.enumname) ?? `Steam's \`${e.enumname}\` enumeration.`;
  return `${jsdoc(doc)}export enum ${e.enumname} {\n${lines.join("\n")}\n}\n`;
}

/** Every enum in the schema, including ones nested inside interfaces and structs. */
export function emitEnums(schema: SteamApiJson, docs?: DocIndex): string {
  const all: Enum[] = [...schema.enums];
  for (const i of schema.interfaces) all.push(...(i.enums ?? []));
  for (const s of [...schema.structs, ...schema.callback_structs]) all.push(...(s.enums ?? []));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of all) {
    if (seen.has(e.enumname)) continue;
    seen.add(e.enumname);
    out.push(emitOne(e, docs));
  }
  return out.join("\n");
}
