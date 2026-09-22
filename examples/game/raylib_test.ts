/**
 * Opens raylib and calls a function that needs no window, so a missing or renamed symbol
 * is caught without anything appearing on screen. Skipped when raylib is not installed.
 */
import { assertEquals } from "@std/assert";
import { Raylib, resolveRaylibPath } from "./raylib.ts";

function haveRaylib(): boolean {
  try {
    resolveRaylibPath();
    return true;
  } catch {
    return false;
  }
}

Deno.test({
  name: "every raylib symbol this demo uses resolves",
  ignore: !haveRaylib(),
  fn() {
    const ray = Raylib.openFirstAvailable();
    try {
      // No window exists, so frameTime is zero, but the call proves the binding works.
      assertEquals(typeof ray.frameTime(), "number");
      assertEquals(typeof ray.isKeyDown(32), "boolean");
    } finally {
      ray.close();
    }
  },
});
