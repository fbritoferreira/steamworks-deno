import { assertEquals } from "@std/assert";
import {
  arrayOut,
  outString,
  readOutString,
  readScalar,
  readScalarArray,
  scalarOut,
  writeScalarArray,
} from "./marshal.ts";

Deno.test("an out string round trips and stops at the terminator", () => {
  const buf = outString(16);
  buf.set(new TextEncoder().encode("beta"));
  assertEquals(readOutString(buf), "beta");
  assertEquals(buf.length, 16);
});

Deno.test("an out string with no terminator reads the whole buffer", () => {
  const buf = new Uint8Array([104, 105]);
  assertEquals(readOutString(buf), "hi");
});

Deno.test("out scalars for each width", () => {
  const b = scalarOut("bool");
  b[0] = 1;
  assertEquals(readScalar(b, "bool"), true);
  const i = scalarOut("i32");
  new DataView(i.buffer).setInt32(0, -5, true);
  assertEquals(readScalar(i, "i32"), -5);
  const f = scalarOut("f32");
  new DataView(f.buffer).setFloat32(0, 1.5, true);
  assertEquals(readScalar(f, "f32"), 1.5);
  const u = scalarOut("u64");
  new DataView(u.buffer).setBigUint64(0, 7n, true);
  assertEquals(readScalar(u, "u64"), 7n);
});

Deno.test("scalar arrays round trip and size correctly", () => {
  const buf = arrayOut("u32", 3);
  assertEquals(buf.length, 12);
  new DataView(buf.buffer).setUint32(4, 42, true);
  assertEquals(readScalarArray(buf, "u32", 3), [0, 42, 0]);
  assertEquals(readScalarArray(writeScalarArray("u64", [1n, 2n]), "u64", 2), [1n, 2n]);
});

Deno.test("a zero or negative count yields an empty result", () => {
  assertEquals(readScalarArray(arrayOut("u32", 0), "u32", 0), []);
  assertEquals(arrayOut("u32", -1).length, 0);
});
