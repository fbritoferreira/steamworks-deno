import type { SteamApiJson, Struct } from "../schema.ts";
import type { MappedType, TypeContext } from "../types.ts";
import type { LayoutResolver, StructLayout } from "../layout.ts";

/**
 * Emits, for each struct: a TypeScript interface, a layout table holding both packings,
 * a decoder, and for non-callback structs an encoder.
 *
 * Offsets and nested struct sizes are read from the layout table at run time, because both
 * differ between pack(4) and pack(8). Scalar sizes never differ, so strides for scalar
 * arrays are emitted as literals.
 */

function tsFieldType(t: MappedType): string {
  if (t.kind === "array" && t.elem) {
    // char[N] is a fixed-width string in the C structs, not an array of numbers.
    return t.elem.native === "u8" ? "string" : `${tsFieldType(t.elem)}[]`;
  }
  if (t.kind === "pointer") return "Deno.PointerValue";
  return t.ts;
}

function readerExpr(field: string, t: MappedType): string {
  const off = `L.${field}`;
  // A `const char *` field: copy the string it points at while Steam still owns it.
  if (t.kind === "string") return `readCStringField(bytes, ${off})`;
  if (t.kind === "struct") {
    return `decode${t.ts}(bytes.subarray(${off}, ${off} + ${t.ts}_layout[PACK].size))`;
  }
  if (t.kind === "array" && t.elem) {
    const e = t.elem;
    if (e.native === "u8") return `readFixedString(bytes, ${off}, ${t.count})`;
    if (e.kind === "struct") {
      return `readArray(bytes, ${off}, ${t.count}, ${e.ts}_layout[PACK].size, (b, o) => ` +
        `decode${e.ts}(b.subarray(o, o + ${e.ts}_layout[PACK].size)))`;
    }
    return `readArray(bytes, ${off}, ${t.count}, ${e.size}, read.${e.native})`;
  }
  if (t.kind === "enum") return `read.i32(bytes, ${off}) as ${t.ts}`;
  return `read.${t.native}(bytes, ${off})`;
}

function writerStmt(field: string, t: MappedType): string {
  const off = `L.${field}`;
  const v = `value.${field}`;
  // Encoding a `const char *` field would need memory outliving this call; leave it null.
  if (t.kind === "string") return `void ${v}; // ${field} is a pointer Steam owns; left null`;
  if (t.kind === "struct") return `out.set(encode${t.ts}(${v}), ${off});`;
  if (t.kind === "array" && t.elem) {
    const e = t.elem;
    if (e.native === "u8") {
      return `out.set(encodeFixedString(${v}, ${t.count}), ${off});`;
    }
    if (e.kind === "struct") {
      return `${v}.forEach((item, i) => out.set(encode${e.ts}(item), ${off} + i * ${e.ts}_layout[PACK].size));`;
    }
    return `writeArray(out, ${off}, ${v}, ${e.size}, write.${e.native});`;
  }
  if (t.kind === "enum") return `write.i32(out, ${off}, ${v});`;
  return `write.${t.native}(out, ${off}, ${v});`;
}

function layoutLiteral(l: StructLayout): string {
  const fields = l.fields.map((f) => `${f.name}: ${f.offset}`).join(", ");
  return fields ? `{ size: ${l.size}, ${fields} }` : `{ size: ${l.size} }`;
}

function emitOne(s: Struct, resolver: LayoutResolver, encodable: boolean): string {
  const l4 = resolver.layout(s.struct, 4);
  const l8 = resolver.layout(s.struct, 8);
  const iface = l4.fields.map((f) => `  ${f.name}: ${tsFieldType(f.type)};`).join("\n");

  // A callback that carries no payload; an empty interface is not a useful type.
  let out = l4.fields.length === 0
    ? `export type ${s.struct} = Record<string, never>;\n\n`
    : `export interface ${s.struct} {\n${iface}\n}\n\n`;
  out += `export const ${s.struct}_layout = {\n  4: ${layoutLiteral(l4)},\n  8: ${
    layoutLiteral(l8)
  },\n} as const;\n\n`;

  const decodeBody = l4.fields
    .map((f) => `    ${f.name}: ${readerExpr(f.name, f.type)},`)
    .join("\n");
  out += `export function decode${s.struct}(bytes: Uint8Array): ${s.struct} {\n`;
  if (l4.fields.length === 0) {
    out += `  void bytes;\n  return {};\n}\n\n`;
  } else {
    out += `  const L = ${s.struct}_layout[PACK];\n  return {\n${decodeBody}\n  };\n}\n\n`;
  }

  if (encodable) {
    out += `export function encode${s.struct}(value: ${s.struct}): Uint8Array {\n`;
    out += `  const out = new Uint8Array(${s.struct}_layout[PACK].size);\n`;
    if (l4.fields.length > 0) {
      const writeBody = l4.fields.map((f) => `  ${writerStmt(f.name, f.type)}`).join("\n");
      out += `  const L = ${s.struct}_layout[PACK];\n${writeBody}\n`;
    } else {
      out += `  void value;\n`;
    }
    out += `  return out;\n}\n\n`;
  }
  return out;
}

/** Order structs so a nested struct is defined before the struct that embeds it. */
function topoSort(structs: Struct[], ctx: TypeContext): Struct[] {
  const byName = new Map(structs.map((s) => [s.struct, s]));
  const done = new Set<string>();
  const out: Struct[] = [];
  const visit = (s: Struct, stack: Set<string>) => {
    if (done.has(s.struct) || stack.has(s.struct)) return;
    stack.add(s.struct);
    for (const f of s.fields) {
      const base = f.fieldtype.replace(/\s*\[\d+\]$/, "").trim();
      if (ctx.structs.has(base) && base !== s.struct) {
        const dep = byName.get(base);
        if (dep) visit(dep, stack);
      }
    }
    stack.delete(s.struct);
    done.add(s.struct);
    out.push(s);
  };
  for (const s of structs) visit(s, new Set());
  return out;
}

export function emitStructs(
  schema: SteamApiJson,
  ctx: TypeContext,
  resolver: LayoutResolver,
): string {
  const plain = new Set(schema.structs.map((s) => s.struct));
  const ordered = topoSort([...schema.structs, ...schema.callback_structs], ctx);

  const usedEnums = new Set<string>();
  for (const s of ordered) {
    for (const f of s.fields) {
      const base = f.fieldtype.replace(/\s*\[\d+\]$/, "").trim();
      if (ctx.enums.has(base)) usedEnums.add(base);
    }
  }

  let out = `import { PACK, read, readArray, write, writeArray } from "../src/layout.ts";\n`;
  out +=
    `import { encodeFixedString, readCStringField, readFixedString } from "../src/cstring.ts";\n`;
  if (usedEnums.size) {
    out += `import type { ${[...usedEnums].sort().join(", ")} } from "./enums.ts";\n`;
  }
  out += "\n";
  for (const s of ordered) out += emitOne(s, resolver, plain.has(s.struct));
  return out;
}
