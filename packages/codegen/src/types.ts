/** Maps C types from `steam_api.json` onto Deno FFI native types and TypeScript types. */
import type { SteamApiJson } from "./schema.ts";

export interface TypeContext {
  typedefs: Map<string, string>;
  enums: Set<string>;
  structs: Set<string>;
}

export type Kind =
  | "void"
  | "bool"
  | "int"
  | "bigint"
  | "float"
  | "enum"
  | "pointer"
  | "string"
  | "struct"
  | "array";

export interface MappedType {
  kind: Kind;
  /** Deno FFI type, or null for aggregates that travel through buffers. */
  native: Deno.NativeResultType | null;
  ts: string;
  size: number;
  align: number;
  elem?: MappedType;
  count?: number;
}

export function buildContext(schema: SteamApiJson): TypeContext {
  const typedefs = new Map(schema.typedefs.map((t) => [t.typedef, t.type]));
  const enums = new Set<string>(schema.enums.map((e) => e.enumname));
  for (const i of schema.interfaces) for (const e of i.enums ?? []) enums.add(e.enumname);
  for (const s of [...schema.structs, ...schema.callback_structs]) {
    for (const e of s.enums ?? []) enums.add(e.enumname);
  }
  const structs = new Set<string>([
    ...schema.structs.map((s) => s.struct),
    ...schema.callback_structs.map((s) => s.struct),
  ]);
  return { typedefs, enums, structs };
}

const PRIMITIVES: Record<string, MappedType> = {
  void: { kind: "void", native: "void", ts: "void", size: 0, align: 1 },
  bool: { kind: "bool", native: "bool", ts: "boolean", size: 1, align: 1 },
  char: { kind: "int", native: "u8", ts: "number", size: 1, align: 1 },
  "unsigned char": { kind: "int", native: "u8", ts: "number", size: 1, align: 1 },
  "signed char": { kind: "int", native: "i8", ts: "number", size: 1, align: 1 },
  short: { kind: "int", native: "i16", ts: "number", size: 2, align: 2 },
  "unsigned short": { kind: "int", native: "u16", ts: "number", size: 2, align: 2 },
  int: { kind: "int", native: "i32", ts: "number", size: 4, align: 4 },
  "unsigned int": { kind: "int", native: "u32", ts: "number", size: 4, align: 4 },
  long: { kind: "bigint", native: "i64", ts: "bigint", size: 8, align: 8 },
  "unsigned long": { kind: "bigint", native: "u64", ts: "bigint", size: 8, align: 8 },
  "long long": { kind: "bigint", native: "i64", ts: "bigint", size: 8, align: 8 },
  "unsigned long long": { kind: "bigint", native: "u64", ts: "bigint", size: 8, align: 8 },
  float: { kind: "float", native: "f32", ts: "number", size: 4, align: 4 },
  double: { kind: "float", native: "f64", ts: "number", size: 8, align: 8 },
  intptr_t: { kind: "bigint", native: "isize", ts: "bigint", size: 8, align: 8 },
  size_t: { kind: "bigint", native: "usize", ts: "bigint", size: 8, align: 8 },
  // CSteamID and CGameID are 64-bit ids, but steamclientpublic.h declares both inside a
  // `#pragma pack(push, 1)` block, so their alignment is 1, not 8. Under pack(8) that keeps
  // UserStatsReceived_t::m_steamIDUser at offset 12 rather than 16. Measured with clang
  // targeting x86_64-pc-windows-msvc against SDK 1.65.
  CSteamID: { kind: "bigint", native: "u64", ts: "bigint", size: 8, align: 1 },
  CGameID: { kind: "bigint", native: "u64", ts: "bigint", size: 8, align: 1 },
  uint64_steamid: { kind: "bigint", native: "u64", ts: "bigint", size: 8, align: 8 },
  uint64_gameid: { kind: "bigint", native: "u64", ts: "bigint", size: 8, align: 8 },
};

const POINTER: MappedType = {
  kind: "pointer",
  native: "pointer",
  ts: "Deno.PointerValue",
  size: 8,
  align: 8,
};

const ARRAY_RE = /^(.+?)\s*\[(\d+)\]$/;

/** Resolve a C type spelling to its FFI and TypeScript representation. */
export function mapType(cType: string, ctx: TypeContext): MappedType {
  const t = cType.replace(/\bconst\b/g, "").replace(/\s+/g, " ").trim();

  const arr = ARRAY_RE.exec(t);
  if (arr) {
    const elem = mapType(arr[1], ctx);
    const count = Number(arr[2]);
    return {
      kind: "array",
      native: null,
      ts: `${elem.ts}[]`,
      size: elem.size * count,
      align: elem.align,
      elem,
      count,
    };
  }
  if (t.endsWith("*") || t.endsWith("&")) {
    const base = t.slice(0, -1).trim();
    if (base === "char") return { ...POINTER, kind: "string", ts: "string" };
    return { ...POINTER };
  }
  if (t in PRIMITIVES) return { ...PRIMITIVES[t] };
  if (ctx.enums.has(t)) return { kind: "enum", native: "i32", ts: t, size: 4, align: 4 };
  if (ctx.structs.has(t)) return { kind: "struct", native: null, ts: t, size: -1, align: -1 };
  const aliased = ctx.typedefs.get(t);
  if (aliased !== undefined) return mapType(aliased, ctx);
  throw new Error(`Unknown C type "${cType}"`);
}
