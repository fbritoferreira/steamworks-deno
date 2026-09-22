/**
 * Runtime support for the generated struct decoders: which packing this OS uses,
 * and little-endian readers and writers for each FFI scalar type.
 */

/** Struct packing the Steamworks headers use here: 8 on Windows, 4 elsewhere. */
export const PACK: 4 | 8 = Deno.build.os === "windows" ? 8 : 4;

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export const read = {
  bool: (b: Uint8Array, o: number): boolean => b[o] !== 0,
  u8: (b: Uint8Array, o: number): number => b[o],
  i8: (b: Uint8Array, o: number): number => view(b).getInt8(o),
  u16: (b: Uint8Array, o: number): number => view(b).getUint16(o, true),
  i16: (b: Uint8Array, o: number): number => view(b).getInt16(o, true),
  u32: (b: Uint8Array, o: number): number => view(b).getUint32(o, true),
  i32: (b: Uint8Array, o: number): number => view(b).getInt32(o, true),
  u64: (b: Uint8Array, o: number): bigint => view(b).getBigUint64(o, true),
  i64: (b: Uint8Array, o: number): bigint => view(b).getBigInt64(o, true),
  usize: (b: Uint8Array, o: number): bigint => view(b).getBigUint64(o, true),
  isize: (b: Uint8Array, o: number): bigint => view(b).getBigInt64(o, true),
  f32: (b: Uint8Array, o: number): number => view(b).getFloat32(o, true),
  f64: (b: Uint8Array, o: number): number => view(b).getFloat64(o, true),
  pointer: (b: Uint8Array, o: number): Deno.PointerValue =>
    Deno.UnsafePointer.create(view(b).getBigUint64(o, true)),
} as const;

export const write = {
  bool: (b: Uint8Array, o: number, v: boolean): void => void (b[o] = v ? 1 : 0),
  u8: (b: Uint8Array, o: number, v: number): void => void (b[o] = v),
  i8: (b: Uint8Array, o: number, v: number): void => view(b).setInt8(o, v),
  u16: (b: Uint8Array, o: number, v: number): void => view(b).setUint16(o, v, true),
  i16: (b: Uint8Array, o: number, v: number): void => view(b).setInt16(o, v, true),
  u32: (b: Uint8Array, o: number, v: number): void => view(b).setUint32(o, v, true),
  i32: (b: Uint8Array, o: number, v: number): void => view(b).setInt32(o, v, true),
  u64: (b: Uint8Array, o: number, v: bigint): void => view(b).setBigUint64(o, v, true),
  i64: (b: Uint8Array, o: number, v: bigint): void => view(b).setBigInt64(o, v, true),
  usize: (b: Uint8Array, o: number, v: bigint): void => view(b).setBigUint64(o, v, true),
  isize: (b: Uint8Array, o: number, v: bigint): void => view(b).setBigInt64(o, v, true),
  f32: (b: Uint8Array, o: number, v: number): void => view(b).setFloat32(o, v, true),
  f64: (b: Uint8Array, o: number, v: number): void => view(b).setFloat64(o, v, true),
  pointer: (b: Uint8Array, o: number, v: Deno.PointerValue): void =>
    view(b).setBigUint64(o, Deno.UnsafePointer.value(v), true),
} as const;

export type ScalarNative = keyof typeof read;

/** Read `count` values of one scalar type laid out end to end. */
export function readArray<T>(
  bytes: Uint8Array,
  offset: number,
  count: number,
  stride: number,
  reader: (b: Uint8Array, o: number) => T,
): T[] {
  const out: T[] = [];
  for (let i = 0; i < count; i++) out.push(reader(bytes, offset + i * stride));
  return out;
}

/** Write `values` of one scalar type end to end into `bytes` at `offset`. */
export function writeArray<T>(
  bytes: Uint8Array,
  offset: number,
  values: readonly T[],
  stride: number,
  writer: (b: Uint8Array, o: number, v: T) => void,
): void {
  values.forEach((v, i) => writer(bytes, offset + i * stride, v));
}
