import { assertEquals } from "@std/assert";
import { steamClientRunning } from "./steam_running.ts";

Deno.test("a library that cannot be opened means no Steam client", () => {
  assertEquals(steamClientRunning({ libraryPath: "/no/such/library.anywhere" }), false);
});
