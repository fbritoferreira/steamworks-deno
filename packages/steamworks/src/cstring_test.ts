import { assertEquals } from "@std/assert";
import { cstr, encodeFixedString, readFixedString } from "./cstring.ts";

Deno.test("cstr appends a NUL terminator", () => {
  assertEquals(cstr("hi"), new Uint8Array([104, 105, 0]));
});

Deno.test("readFixedString stops at the first NUL", () => {
  const b = new Uint8Array(8);
  b.set(new TextEncoder().encode("abc"));
  assertEquals(readFixedString(b, 0, 8), "abc");
});

Deno.test("readFixedString reads a slice at an offset", () => {
  const b = new Uint8Array(16);
  b.set(new TextEncoder().encode("name"), 4);
  assertEquals(readFixedString(b, 4, 8), "name");
});

Deno.test("encodeFixedString pads to width and always leaves room for the NUL", () => {
  assertEquals(encodeFixedString("ab", 4), new Uint8Array([97, 98, 0, 0]));
  assertEquals(encodeFixedString("abcdef", 4), new Uint8Array([97, 98, 99, 0]));
});
