import { assertEquals } from "@std/assert";
import { jsdoc } from "./jsdoc.ts";

Deno.test("nothing to say yields nothing", () => {
  assertEquals(jsdoc(undefined), "");
  assertEquals(jsdoc(""), "");
});

Deno.test("one line becomes a single-line block", () => {
  assertEquals(jsdoc("Returns the count."), "/** Returns the count. */\n");
});

Deno.test("several lines become a block, indented", () => {
  assertEquals(
    jsdoc("First.\nSecond.", "  "),
    "  /**\n   * First.\n   * Second.\n   */\n",
  );
});

Deno.test("a comment terminator inside the text is escaped", () => {
  assertEquals(jsdoc("ends with */ inside"), "/** ends with *\\/ inside */\n");
});
