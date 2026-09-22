/**
 * Computes struct sizes and field offsets for both packings the Steamworks headers use:
 * `#pragma pack(4)` on macOS, Linux and FreeBSD, `#pragma pack(8)` on Windows.
 * `steam_api.json` carries no layout information, so this reimplements the C rules.
 */
import type { SteamApiJson, Struct } from "./schema.ts";
import { type MappedType, mapType, type TypeContext } from "./types.ts";
import { effectivePack, type PackMode } from "./packscan.ts";

export type Pack = 4 | 8;

export interface FieldLayout {
  name: string;
  type: MappedType;
  offset: number;
}

export interface StructLayout {
  name: string;
  size: number;
  align: number;
  fields: FieldLayout[];
}

const alignUp = (n: number, a: number) => Math.ceil(n / a) * a;

export class LayoutResolver {
  readonly #structs = new Map<string, Struct>();
  readonly #callbackIds = new Map<string, number>();
  readonly #cache = new Map<string, StructLayout>();
  readonly #ctx: TypeContext;
  readonly #packing: Map<string, PackMode>;

  constructor(schema: SteamApiJson, ctx: TypeContext, packing = new Map<string, PackMode>()) {
    for (const s of [...schema.structs, ...schema.callback_structs]) this.#structs.set(s.struct, s);
    for (const c of schema.callback_structs) this.#callbackIds.set(c.struct, c.callback_id);
    this.#ctx = ctx;
    this.#packing = packing;
  }

  /** The alignment cap for one struct under a platform packing, from its header. */
  packFor(structName: string, platform: Pack): number {
    return effectivePack(this.#packing.get(structName), platform);
  }

  /** Callback id for a callback struct. Throws if the struct is not one. */
  callbackId(structName: string): number {
    const id = this.#callbackIds.get(structName);
    if (id === undefined) throw new Error(`"${structName}" is not a callback struct`);
    return id;
  }

  isCallback(structName: string): boolean {
    return this.#callbackIds.has(structName);
  }

  knows(structName: string): boolean {
    return this.#structs.has(structName);
  }

  /** Size and alignment of any type under a packing, resolving nested structs. */
  sizeAlign(type: MappedType, pack: Pack): { size: number; align: number } {
    if (type.kind === "struct") {
      const l = this.layout(type.ts, pack);
      return { size: l.size, align: l.align };
    }
    if (type.kind === "array" && type.elem) {
      const e = this.sizeAlign(type.elem, pack);
      return { size: e.size * (type.count ?? 0), align: e.align };
    }
    return { size: type.size, align: type.align };
  }

  layout(structName: string, pack: Pack): StructLayout {
    const key = `${structName}#${pack}`;
    const hit = this.#cache.get(key);
    if (hit) return hit;
    const def = this.#structs.get(structName);
    if (!def) throw new Error(`Unknown struct "${structName}"`);

    // The header decides this struct's packing; `pack` only says which platform we are on.
    const cap = this.packFor(structName, pack);
    let offset = 0;
    let structAlign = 1;
    const fields: FieldLayout[] = [];
    for (const f of def.fields) {
      const type = mapType(f.fieldtype, this.#ctx);
      const { size, align } = this.sizeAlign(type, pack);
      const a = Math.min(align, cap); // #pragma pack caps each field's alignment
      offset = alignUp(offset, a);
      fields.push({ name: f.fieldname, type, offset });
      offset += size;
      structAlign = Math.max(structAlign, a);
    }
    // An empty C++ struct still occupies one byte.
    const size = fields.length === 0 ? 1 : alignUp(offset, structAlign);
    const result = { name: structName, size, align: structAlign, fields };
    this.#cache.set(key, result);
    return result;
  }
}
