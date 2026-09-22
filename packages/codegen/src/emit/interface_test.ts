import { assertEquals, assertStringIncludes } from "@std/assert";
import { loadSchema } from "../schema.ts";
import { buildContext } from "../types.ts";
import { LayoutResolver } from "../layout.ts";
import { platformPacking } from "../testing.ts";
import { emitInterface, tsMethodName } from "./interface.ts";
import { emitStructs } from "./structs.ts";
import { emitEnums } from "./enums.ts";
import { header } from "./header.ts";
import { fromFileUrl } from "@std/path";

const schema = await loadSchema(
  fromFileUrl(new URL("../../fixtures/steam_api.mini.json", import.meta.url)),
);
const ctx = buildContext(schema);
const resolver = new LayoutResolver(schema, ctx, platformPacking(schema));
const iface = (n: string) => schema.interfaces.find((i) => i.classname === n)!;

Deno.test("the symbol table types every parameter and marks the accessor optional", () => {
  const out = emitInterface(iface("ISteamUserStats"), ctx, resolver);
  assertStringIncludes(
    out,
    'SteamAPI_ISteamUserStats_GetAchievement: { parameters: ["pointer", "buffer", "buffer"], result: "bool" },',
  );
  assertStringIncludes(
    out,
    'SteamAPI_ISteamUserStats_RequestUserStats: { parameters: ["pointer", "u64"], result: "u64" },',
  );
  assertStringIncludes(
    out,
    'SteamAPI_SteamUserStats_v013: { parameters: [], result: "pointer", optional: true },',
  );
  assertStringIncludes(out, 'static readonly accessor = "SteamAPI_SteamUserStats_v013";');
});

Deno.test("an out scalar is hidden and returned alongside the C return value", () => {
  const out = emitInterface(iface("ISteamUserStats"), ctx, resolver);
  assertStringIncludes(
    out,
    "getAchievement(pchName: string): { ok: boolean; pbAchieved: boolean }",
  );
  assertStringIncludes(out, 'const pbAchieved_buf = scalarOut("bool");');
});

Deno.test("a call result becomes a promise for the decoded struct", () => {
  const out = emitInterface(iface("ISteamUserStats"), ctx, resolver);
  assertStringIncludes(out, "requestUserStats(steamIDUser: bigint): Promise<UserStatsReceived_t>");
  assertStringIncludes(
    out,
    "return this.host.callResult(call, 1101, decodeUserStatsReceived_t);",
  );
});

Deno.test("an out string gets a default size and returns the text", () => {
  const out = emitInterface(iface("ISteamApps"), ctx, resolver);
  assertStringIncludes(
    out,
    "getCurrentBetaName(cchNameBufferSize = 256): { ok: boolean; pchName: string }",
  );
});

Deno.test("an out array is sized by its count parameter", () => {
  const out = emitInterface(iface("ISteamApps"), ctx, resolver);
  assertStringIncludes(out, "getInstalledDepots(appID: number, cMaxDepots: number): number[]");
});

Deno.test("a filled struct comes back, or null when the call reports failure", () => {
  const out = emitInterface(iface("ISteamFriends"), ctx, resolver);
  assertStringIncludes(
    out,
    "getFriendGamePlayed(steamIDFriend: bigint): FriendGameInfo_t | null",
  );
});

Deno.test("a returned const char* is copied into a string", () => {
  const out = emitInterface(iface("ISteamFriends"), ctx, resolver);
  assertStringIncludes(out, "getPersonaName(): string");
  assertStringIncludes(out, "return readCString(this.s.SteamAPI_ISteamFriends_GetPersonaName");
});

Deno.test("overloads are separated by the suffix in the flat name", () => {
  const stats = iface("ISteamUserStats");
  const getStat = stats.methods.filter((m) => m.methodname === "GetStat");
  assertEquals(getStat.length > 1, true, "GetStat should be overloaded in the SDK");
  const names = getStat.map((m) => tsMethodName(m, stats.methods));
  assertEquals(new Set(names).size, names.length, "each overload needs a distinct name");
  assertEquals(names.includes("getStatInt32"), true);
});

Deno.test("every fixture interface compiles against the runtime", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.mkdir(`${dir}/gen/interfaces`, { recursive: true });
  await Deno.symlink(
    fromFileUrl(new URL("../../../steamworks/src", import.meta.url)),
    `${dir}/src`,
  );
  const h = header("test");
  await Deno.writeTextFile(`${dir}/gen/enums.ts`, h + emitEnums(schema));
  await Deno.writeTextFile(`${dir}/gen/structs.ts`, h + emitStructs(schema, ctx, resolver));
  const paths: string[] = [];
  for (const i of schema.interfaces) {
    const p = `${dir}/gen/interfaces/${i.classname}.ts`;
    await Deno.writeTextFile(p, h + emitInterface(i, ctx, resolver));
    paths.push(p);
  }
  const check = await new Deno.Command(Deno.execPath(), {
    args: ["check", ...paths],
    stderr: "piped",
  }).output();
  assertEquals(check.success, true, new TextDecoder().decode(check.stderr));
});

Deno.test({
  name: "generated methods carry the documentation from the SDK headers",
  ignore: !Deno.env.get("STEAMWORKS_SDK_PATH"),
  async fn() {
    const { scanDocs } = await import("../docscan.ts");
    const dir = `${Deno.env.get("STEAMWORKS_SDK_PATH")}/public/steam`;
    const headers: { name: string; text: string }[] = [];
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && entry.name.endsWith(".h")) {
        headers.push({ name: entry.name, text: await Deno.readTextFile(`${dir}/${entry.name}`) });
      }
    }
    const docs = scanDocs(headers);
    const out = emitInterface(iface("ISteamUserStats"), ctx, resolver, docs);
    // isteamuserstats.h documents this one, and the text must survive into JSDoc.
    assertStringIncludes(out, "Get the achievement status, and the time it was unlocked");
    assertStringIncludes(out, "  /**");
  },
});
