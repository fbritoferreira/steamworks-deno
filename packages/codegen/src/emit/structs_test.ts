import { assertEquals, assertStringIncludes } from "@std/assert";
import { loadSchema } from "../schema.ts";
import { buildContext } from "../types.ts";
import { LayoutResolver } from "../layout.ts";
import { platformPacking } from "../testing.ts";
import { emitStructs } from "./structs.ts";
import { emitCallbackIds } from "./callback_ids.ts";
import { emitLayoutJson } from "./layout_json.ts";
import { emitEnums } from "./enums.ts";
import { emitConsts } from "./consts.ts";
import { header } from "./header.ts";
import { fromFileUrl, toFileUrl } from "@std/path";

const schema = await loadSchema(
  fromFileUrl(new URL("../../fixtures/steam_api.mini.json", import.meta.url)),
);
const ctx = buildContext(schema);
const resolver = new LayoutResolver(schema, ctx, platformPacking(schema));

Deno.test("emitStructs writes an interface, both layouts and a decoder", () => {
  const out = emitStructs(schema, ctx, resolver);
  assertStringIncludes(out, "export interface UserStatsReceived_t {");
  assertStringIncludes(out, "  m_steamIDUser: bigint;");
  assertStringIncludes(out, "4: { size: 20, m_nGameID: 0, m_eResult: 8, m_steamIDUser: 12 }");
  assertStringIncludes(out, "8: { size: 24, m_nGameID: 0, m_eResult: 8, m_steamIDUser: 12 }");
  assertStringIncludes(out, "export function decodeUserStatsReceived_t");
  assertStringIncludes(out, "readFixedString(bytes, L.m_rgchAchievementName, 128)");
});

Deno.test("callback structs get no encoder, plain structs do", () => {
  const out = emitStructs(schema, ctx, resolver);
  assertStringIncludes(out, "export function encodeFriendGameInfo_t");
  assertEquals(out.includes("export function encodeUserStatsReceived_t"), false);
});

Deno.test("emitCallbackIds maps names to ids and ids to decoders", () => {
  const out = emitCallbackIds(schema);
  assertStringIncludes(out, "UserStatsReceived: 1101,");
  assertStringIncludes(out, "1101: decodeUserStatsReceived_t,");
});

Deno.test("emitLayoutJson carries both packings", () => {
  const json = JSON.parse(emitLayoutJson(schema, resolver));
  assertEquals(json.pack["4"].UserStatsReceived_t.size, 20);
  assertEquals(json.pack["8"].UserStatsReceived_t.size, 24);
  assertEquals(json.pack["8"].UserStatsReceived_t.fields.m_steamIDUser, 12);
});

Deno.test("generated code compiles and decodes a real callback payload", async () => {
  const dir = await Deno.makeTempDir();
  const runtime = fromFileUrl(new URL("../../../steamworks/src", import.meta.url));
  await Deno.mkdir(`${dir}/gen`);
  await Deno.symlink(runtime, `${dir}/src`);
  const h = header("test");
  await Deno.writeTextFile(`${dir}/gen/enums.ts`, h + emitEnums(schema));
  await Deno.writeTextFile(`${dir}/gen/consts.ts`, h + emitConsts(schema, ctx));
  await Deno.writeTextFile(`${dir}/gen/structs.ts`, h + emitStructs(schema, ctx, resolver));
  await Deno.writeTextFile(`${dir}/gen/callback_ids.ts`, h + emitCallbackIds(schema));

  const check = await new Deno.Command(Deno.execPath(), {
    args: ["check", `${dir}/gen/structs.ts`, `${dir}/gen/callback_ids.ts`, `${dir}/gen/consts.ts`],
    stderr: "piped",
  }).output();
  assertEquals(check.success, true, new TextDecoder().decode(check.stderr));

  // A dynamic import needs a URL; a bare Windows path has an unsupported "c:" scheme.
  const mod = await import(toFileUrl(`${dir}/gen/structs.ts`).href);
  // A UserAchievementStored_t as Steam would deliver it.
  const bytes = new Uint8Array(mod.UserAchievementStored_t_layout[4].size);
  const dv = new DataView(bytes.buffer);
  dv.setBigUint64(0, 480n, true);
  bytes.set(new TextEncoder().encode("ACH_WIN_ONE_GAME"), 9);
  dv.setUint32(140, 3, true);
  dv.setUint32(144, 10, true);
  const v = mod.decodeUserAchievementStored_t(bytes);
  assertEquals(v.m_nGameID, 480n);
  assertEquals(v.m_rgchAchievementName, "ACH_WIN_ONE_GAME");
  assertEquals(v.m_bGroupAchievement, false);
  assertEquals([v.m_nCurProgress, v.m_nMaxProgress], [3, 10]);

  // A plain struct round-trips through its encoder.
  const info = {
    m_gameID: 7n,
    m_unGameIP: 1,
    m_usGamePort: 2,
    m_usQueryPort: 3,
    m_steamIDLobby: 9n,
  };
  assertEquals(mod.decodeFriendGameInfo_t(mod.encodeFriendGameInfo_t(info)), info);
});

Deno.test("consts evaluate C expressions", () => {
  const out = emitConsts(schema, ctx);
  assertStringIncludes(out, "export const k_uAPICallInvalid = 0n;");
  assertStringIncludes(out, "export const k_cchMaxSteamErrMsg = 1024;");
  assertStringIncludes(out, "export const k_UGCHandleInvalid = 18446744073709551615n;");
  assertStringIncludes(out, "export const k_cchPublishedDocumentTitleMax = 129;");
  assertStringIncludes(out, "export const k_unMaxCloudFileChunkSize = 104857600;");
  assertStringIncludes(out, "export const k_SteamInventoryResultInvalid = -1;");
});

Deno.test("emitCallbackIds writes a name to struct type map", () => {
  const out = emitCallbackIds(schema);
  assertStringIncludes(out, "export interface CallbackMap {");
  assertStringIncludes(out, "  UserStatsStored: UserStatsStored_t;");
  assertStringIncludes(out, "  UserAchievementStored: UserAchievementStored_t;");
  // Every name in CallbackId has an entry in CallbackMap.
  const ids = [...out.matchAll(/^  (\w+): \d+,$/gm)].map((m) => m[1]);
  const mapped = [...out.matchAll(/^  (\w+): \w+_t;$/gm)].map((m) => m[1]);
  assertEquals(new Set(ids).size, new Set(mapped).size);
});
