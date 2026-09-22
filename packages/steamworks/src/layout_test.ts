import { assertEquals } from "@std/assert";
import { PACK, read, readArray, write, writeArray } from "./layout.ts";

Deno.test("PACK is 4 off Windows and 8 on it", () => {
  assertEquals(PACK, Deno.build.os === "windows" ? 8 : 4);
});

Deno.test("scalar readers and writers round trip little-endian", () => {
  const b = new Uint8Array(8);
  write.u32(b, 0, 0xdeadbeef);
  assertEquals(read.u32(b, 0), 0xdeadbeef);
  assertEquals(b[0], 0xef, "little-endian puts the low byte first");
  write.i16(b, 0, -2);
  assertEquals(read.i16(b, 0), -2);
  write.u64(b, 0, 2n ** 63n);
  assertEquals(read.u64(b, 0), 2n ** 63n);
  write.f32(b, 0, 1.5);
  assertEquals(read.f32(b, 0), 1.5);
  write.bool(b, 0, true);
  assertEquals(read.bool(b, 0), true);
});

Deno.test("array helpers round trip", () => {
  const b = new Uint8Array(12);
  writeArray(b, 0, [1, 2, 3], 4, write.u32);
  assertEquals(readArray(b, 0, 3, 4, read.u32), [1, 2, 3]);
});
