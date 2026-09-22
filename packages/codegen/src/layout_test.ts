/**
 * Expected values measured with clang 17 against Steamworks SDK 1.65 headers on 2026-09-22:
 * natively on macOS for pack(4), and with `-target x86_64-pc-windows-msvc
 * -Xclang -fdump-record-layouts` for pack(8).
 */
import { assertEquals } from "@std/assert";
import { loadSchema } from "./schema.ts";
import { buildContext } from "./types.ts";
import { LayoutResolver } from "./layout.ts";
import { platformPacking } from "./testing.ts";

const schema = await loadSchema(
  new URL("../fixtures/steam_api.mini.json", import.meta.url).pathname,
);
// CallbackMsg_t and ValvePackingSentinel_t arrive through schema_patch.ts.
const ctx = buildContext(schema);
const r = new LayoutResolver(schema, ctx, platformPacking(schema));
const offsets = (name: string, pack: 4 | 8) =>
  Object.fromEntries(r.layout(name, pack).fields.map((f) => [f.name, f.offset]));

Deno.test("ValvePackingSentinel_t matches the SDK compile-time asserts", () => {
  assertEquals(r.layout("ValvePackingSentinel_t", 4).size, 24);
  assertEquals(r.layout("ValvePackingSentinel_t", 8).size, 32);
  assertEquals(offsets("ValvePackingSentinel_t", 4), { m_u32: 0, m_u64: 4, m_u16: 12, m_d: 16 });
  assertEquals(offsets("ValvePackingSentinel_t", 8), { m_u32: 0, m_u64: 8, m_u16: 16, m_d: 24 });
});

Deno.test("UserStatsReceived_t grows by trailing padding, CSteamID stays at 12", () => {
  // CSteamID is declared under `#pragma pack(push, 1)`, so it never forces 8-byte alignment.
  assertEquals(r.layout("UserStatsReceived_t", 4).size, 20);
  assertEquals(r.layout("UserStatsReceived_t", 8).size, 24);
  assertEquals(offsets("UserStatsReceived_t", 4).m_steamIDUser, 12);
  assertEquals(offsets("UserStatsReceived_t", 8).m_steamIDUser, 12);
});

Deno.test("RemoteStorageEnumerateUserSubscribedFilesResult_t is 612 against 616", () => {
  assertEquals(r.layout("RemoteStorageEnumerateUserSubscribedFilesResult_t", 4).size, 612);
  assertEquals(r.layout("RemoteStorageEnumerateUserSubscribedFilesResult_t", 8).size, 616);
  const four = offsets("RemoteStorageEnumerateUserSubscribedFilesResult_t", 4);
  const eight = offsets("RemoteStorageEnumerateUserSubscribedFilesResult_t", 8);
  assertEquals([four.m_rgPublishedFileId, four.m_rgRTimeSubscribed], [12, 412]);
  assertEquals([eight.m_rgPublishedFileId, eight.m_rgRTimeSubscribed], [16, 416]);
});

Deno.test("CallbackMsg_t keeps its offsets and differs only in trailing padding", () => {
  const expected = { m_hSteamUser: 0, m_iCallback: 4, m_pubParam: 8, m_cubParam: 16 };
  assertEquals(offsets("CallbackMsg_t", 4), expected);
  assertEquals(offsets("CallbackMsg_t", 8), expected);
  assertEquals(r.layout("CallbackMsg_t", 4).size, 20);
  assertEquals(r.layout("CallbackMsg_t", 8).size, 24);
});

Deno.test("UserAchievementStored_t keeps its offsets, size 148 against 152", () => {
  assertEquals(r.layout("UserAchievementStored_t", 4).size, 148);
  assertEquals(r.layout("UserAchievementStored_t", 8).size, 152);
  for (const pack of [4, 8] as const) {
    assertEquals(offsets("UserAchievementStored_t", pack), {
      m_nGameID: 0,
      m_bGroupAchievement: 8,
      m_rgchAchievementName: 9,
      m_nCurProgress: 140,
      m_nMaxProgress: 144,
    });
  }
});

Deno.test("sizes measured with clang for the remaining fixture callbacks", () => {
  const sizes = (n: string) => [r.layout(n, 4).size, r.layout(n, 8).size];
  assertEquals(sizes("UserStatsStored_t"), [12, 16]);
  assertEquals(sizes("GlobalAchievementPercentagesReady_t"), [12, 16]);
  assertEquals(sizes("SteamAPICallCompleted_t"), [16, 16]);
  assertEquals(sizes("GameOverlayActivated_t"), [12, 12]);
  assertEquals(offsets("GameOverlayActivated_t", 8), {
    m_bActive: 0,
    m_bUserInitiated: 1,
    m_nAppID: 4,
    m_dwOverlayPID: 8,
  });
});

Deno.test("FriendGameInfo_t nests two 8-byte ids and is 24 under both", () => {
  assertEquals(r.layout("FriendGameInfo_t", 4).size, 24);
  assertEquals(r.layout("FriendGameInfo_t", 8).size, 24);
  assertEquals(offsets("FriendGameInfo_t", 8).m_steamIDLobby, 16);
});

Deno.test("a struct with no fields occupies one byte", () => {
  assertEquals(r.layout("SteamServersConnected_t", 4).size, 1);
});

Deno.test("callbackId resolves and rejects plain structs", () => {
  assertEquals(r.callbackId("UserStatsReceived_t"), 1101);
  assertEquals(r.isCallback("FriendGameInfo_t"), false);
});
