import { assertEquals } from "@std/assert";
import { loadSchema } from "./schema.ts";
import { buildContext } from "./types.ts";
import { classify } from "./params.ts";
import { fromFileUrl } from "@std/path";

const schema = await loadSchema(
  fromFileUrl(new URL("../fixtures/steam_api.mini.json", import.meta.url)),
);
const ctx = buildContext(schema);
const byName = (cls: string, name: string) =>
  schema.interfaces.find((i) => i.classname === cls)!.methods.find((m) => m.methodname === name)!;
const byFlat = (cls: string, flat: string) =>
  schema.interfaces.find((i) => i.classname === cls)!.methods.find((m) =>
    m.methodname_flat === flat
  )!;
const roles = (cls: string, name: string) =>
  classify(byName(cls, name), ctx).params.map((p) => [p.name, p.role.role]);

Deno.test("GetAchievement takes a string and returns a bool through a pointer", () => {
  assertEquals(roles("ISteamUserStats", "GetAchievement"), [
    ["pchName", "in-string"],
    ["pbAchieved", "out-scalar"],
  ]);
});

Deno.test("GetCurrentBetaName is an out string whose size parameter is hidden", () => {
  assertEquals(roles("ISteamApps", "GetCurrentBetaName"), [
    ["pchName", "out-string"],
    ["cchNameBufferSize", "count"],
  ]);
});

Deno.test("GetInstalledDepots fills an array sized by cMaxDepots", () => {
  assertEquals(roles("ISteamApps", "GetInstalledDepots"), [
    ["appID", "in"],
    ["pvecDepots", "out-array"],
    ["cMaxDepots", "count"],
  ]);
});

Deno.test("GetFriendGamePlayed takes an id and fills a struct", () => {
  const c = classify(byName("ISteamFriends", "GetFriendGamePlayed"), ctx);
  assertEquals(c.params[0].role.role, "in");
  assertEquals(c.params[1].role, { role: "out-struct", struct: "FriendGameInfo_t" });
});

Deno.test("RequestUserStats carries its call result and returns a handle", () => {
  const c = classify(byName("ISteamUserStats", "RequestUserStats"), ctx);
  assertEquals(c.callresult, "UserStatsReceived_t");
  assertEquals(c.returns.native, "u64");
});

Deno.test("the overload suffix in the flat name disambiguates GetStat", () => {
  const c = classify(byFlat("ISteamUserStats", "SteamAPI_ISteamUserStats_GetStatInt32"), ctx);
  assertEquals(c.params.map((p) => p.role.role), ["in-string", "out-scalar"]);
});

Deno.test("every parameter of every fixture method classifies without throwing", () => {
  for (const i of schema.interfaces) {
    for (const m of i.methods) {
      classify(m, ctx);
    }
  }
});
