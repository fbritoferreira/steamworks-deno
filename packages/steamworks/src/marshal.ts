/** Helpers the generated interface wrappers use to move values across the FFI boundary. */
import { read, readArray, type ScalarNative, write, writeArray } from "./layout.ts";
import { cstr } from "./cstring.ts";

/** What a generated wrapper needs from the client to turn a call handle into a promise. */
export interface CallResultHost {
  callResult<T>(
    handle: bigint,
    callbackId: number,
    decode: (bytes: Uint8Array) => T,
  ): Promise<T>;
}

const SIZE: Record<ScalarNative, number> = {
  bool: 1,
  u8: 1,
  i8: 1,
  u16: 2,
  i16: 2,
  u32: 4,
  i32: 4,
  f32: 4,
  u64: 8,
  i64: 8,
  f64: 8,
  usize: 8,
  isize: 8,
  pointer: 8,
};

/** Encode a string as a NUL-terminated buffer for a `const char *` parameter. */
export { cstr as cstrArg };

/** Allocate a `char[size]` out buffer for Steam to fill. */
export function outString(size: number): Uint8Array {
  return new Uint8Array(Math.max(1, size));
}

/** Read an out buffer Steam filled, stopping at the NUL terminator. */
export function readOutString(buf: Uint8Array): string {
  const nul = buf.indexOf(0);
  return new TextDecoder().decode(nul === -1 ? buf : buf.subarray(0, nul));
}

/** Allocate a buffer for a single out scalar. */
export function scalarOut(native: ScalarNative): Uint8Array {
  return new Uint8Array(SIZE[native]);
}

/** Read a single out scalar back out of its buffer. */
export function readScalar(
  buf: Uint8Array,
  native: ScalarNative,
): number | bigint | boolean | Deno.PointerValue {
  return read[native](buf, 0);
}

/** Allocate room for `count` values of one scalar type. */
export function arrayOut(native: ScalarNative, count: number): Uint8Array {
  return new Uint8Array(SIZE[native] * Math.max(0, count));
}

/** Read `count` values of one scalar type out of a buffer Steam filled. */
export function readScalarArray(
  buf: Uint8Array,
  native: ScalarNative,
  count: number,
): unknown[] {
  // The reader union does not unify on its own; every member has the same shape.
  const reader = read[native] as (b: Uint8Array, o: number) => unknown;
  return readArray(buf, 0, Math.max(0, count), SIZE[native], reader);
}

/** Pack values of one scalar type into a buffer to pass into Steam. */
export function writeScalarArray(native: ScalarNative, values: readonly unknown[]): Uint8Array {
  const buf = new Uint8Array(SIZE[native] * values.length);
  const writer = write[native] as (b: Uint8Array, o: number, v: unknown) => void;
  writeArray(buf, 0, values, SIZE[native], writer);
  return buf;
}
