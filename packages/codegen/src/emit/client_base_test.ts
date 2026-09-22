import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { loadSchema } from "../schema.ts";
import { emitClientBase, getterName, reachableInterfaces } from "./client_base.ts";

const schema = await loadSchema(
  fromFileUrl(new URL("../../fixtures/steam_api.mini.json", import.meta.url)),
);

Deno.test("getterName drops the prefix and lowers the leading capitals", () => {
  assertEquals(getterName("ISteamUser"), "user");
  assertEquals(getterName("ISteamUserStats"), "userStats");
  assertEquals(getterName("ISteamUGC"), "ugc");
  assertEquals(getterName("ISteamHTMLSurface"), "htmlSurface");
  assertEquals(getterName("ISteamHTTP"), "http");
  assertEquals(getterName("ISteamApps"), "apps");
});

Deno.test("only interfaces with a user or global accessor are reachable", () => {
  const names = reachableInterfaces(schema).map((i) => i.classname);
  assertEquals(names.includes("ISteamUser"), true);
  assertEquals(names.includes("ISteamUtils"), true);
  // A caller implements these rather than receiving them.
  assertEquals(names.includes("ISteamMatchmakingPingResponse"), false);
  // Obtained through its own entry point, not an accessor.
  assertEquals(names.includes("ISteamClient"), false);
});

Deno.test("emitClientBase writes one getter per reachable interface", () => {
  const out = emitClientBase(schema);
  assertStringIncludes(out, "export abstract class SteamInterfaces {");
  assertStringIncludes(out, "get userStats(): ISteamUserStats {");
  assertStringIncludes(
    out,
    'return this.iface(\n      "ISteamUserStats",\n      ISteamUserStats_symbols,',
  );
  assertEquals(out.match(/^ {2}get /gm)?.length, reachableInterfaces(schema).length);
});
