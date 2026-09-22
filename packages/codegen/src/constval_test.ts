import { assertEquals, assertThrows } from "@std/assert";
import { evalConst } from "./constval.ts";

Deno.test("plain literals", () => {
  assertEquals(evalConst("0x0"), 0n);
  assertEquals(evalConst("0"), 0n);
  assertEquals(evalConst("1024"), 1024n);
  assertEquals(evalConst("0xFFFFFFFF"), 0xffffffffn);
});

Deno.test("integer suffixes are stripped", () => {
  assertEquals(evalConst("0xffffffffffffffffull", 64), 0xffffffffffffffffn);
});

Deno.test("arithmetic, honouring precedence", () => {
  assertEquals(evalConst("128 + 1"), 129n);
  assertEquals(evalConst("1024 + 1"), 1025n);
  assertEquals(evalConst("100 * 1024 * 1024"), 104857600n);
  assertEquals(evalConst("2 + 3 * 4"), 14n);
});

Deno.test("unary minus and bitwise not within the target width", () => {
  assertEquals(evalConst("- 1"), -1n);
  assertEquals(evalConst("~ 0", 64), 0xffffffffffffffffn);
  assertEquals(evalConst("~ 0", 32), 0xffffffffn);
});

Deno.test("a cast to a named type is ignored", () => {
  assertEquals(evalConst("( SteamItemInstanceID_t ) ~ 0", 64), 0xffffffffffffffffn);
});

Deno.test("unparseable input throws", () => {
  assertThrows(() => evalConst("sizeof(int)"));
});
