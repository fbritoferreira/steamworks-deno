import { assert, assertEquals, assertRejects } from "@std/assert";
import { loadSchema } from "./schema.ts";

const FIXTURE = new URL("../fixtures/steam_api.mini.json", import.meta.url).pathname;

Deno.test("loadSchema reads the fixture and exposes the six top-level arrays", async () => {
  const s = await loadSchema(FIXTURE);
  assertEquals(s.interfaces.length, 5);
  assertEquals(s.callback_structs.length, 8);
  assert(s.typedefs.some((t) => t.typedef === "SteamAPICall_t" && t.type === "unsigned long long"));
});

Deno.test("loadSchema rejects a file missing a required array", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".json" });
  // Everything present except callback_structs, so the error names that one.
  await Deno.writeTextFile(
    tmp,
    JSON.stringify({ typedefs: [], consts: [], enums: [], structs: [], interfaces: [] }),
  );
  await assertRejects(() => loadSchema(tmp), Error, "callback_structs");
});
