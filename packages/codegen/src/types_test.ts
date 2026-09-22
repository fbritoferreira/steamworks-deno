import { assertEquals, assertThrows } from "@std/assert";
import { loadSchema } from "./schema.ts";
import { buildContext, mapType } from "./types.ts";

const ctx = buildContext(
  await loadSchema(new URL("../fixtures/steam_api.mini.json", import.meta.url).pathname),
);

Deno.test("primitives", () => {
  assertEquals(mapType("bool", ctx), {
    kind: "bool",
    native: "bool",
    ts: "boolean",
    size: 1,
    align: 1,
  });
  assertEquals(mapType("int", ctx).native, "i32");
  assertEquals(mapType("uint32", ctx).native, "u32");
  assertEquals(mapType("uint16", ctx).native, "u16");
  assertEquals(mapType("float", ctx).native, "f32");
  assertEquals(mapType("double", ctx).native, "f64");
});

Deno.test("64-bit types are bigint and 8-byte aligned", () => {
  for (const t of ["uint64", "SteamAPICall_t", "uint64_steamid", "uint64_gameid"]) {
    const m = mapType(t, ctx);
    assertEquals([m.kind, m.native, m.ts, m.size, m.align], ["bigint", "u64", "bigint", 8, 8], t);
  }
  assertEquals(mapType("int64", ctx).native, "i64");
});

Deno.test("CSteamID and CGameID are 8 bytes but align to 1", () => {
  // steamclientpublic.h declares both inside `#pragma pack(push, 1)`.
  for (const t of ["CSteamID", "CGameID"]) {
    const m = mapType(t, ctx);
    assertEquals([m.kind, m.native, m.size, m.align], ["bigint", "u64", 8, 1], t);
  }
});

Deno.test("typedef chains resolve", () => {
  assertEquals(mapType("AppId_t", ctx).native, "u32");
  assertEquals(mapType("HSteamPipe", ctx).native, "i32");
});

Deno.test("enums are i32 carrying the enum name", () => {
  assertEquals(mapType("EResult", ctx), {
    kind: "enum",
    native: "i32",
    ts: "EResult",
    size: 4,
    align: 4,
  });
});

Deno.test("strings and pointers", () => {
  assertEquals(mapType("const char *", ctx).kind, "string");
  assertEquals(mapType("char *", ctx).kind, "string");
  assertEquals(mapType("ISteamUser *", ctx).native, "pointer");
  assertEquals(mapType("bool *", ctx).kind, "pointer");
  assertEquals(mapType("void *", ctx).kind, "pointer");
});

Deno.test("structs and fixed arrays", () => {
  const s = mapType("FriendGameInfo_t", ctx);
  assertEquals([s.kind, s.native, s.ts, s.size], ["struct", null, "FriendGameInfo_t", -1]);
  const a = mapType("char [128]", ctx);
  assertEquals([a.kind, a.count, a.elem?.native, a.size, a.align], ["array", 128, "u8", 128, 1]);
  const b = mapType("PublishedFileId_t [50]", ctx);
  assertEquals([b.count, b.elem?.native, b.size, b.align], [50, "u64", 400, 8]);
});

Deno.test("unknown type throws naming it", () => {
  assertThrows(() => mapType("Nonsense_t", ctx), Error, "Nonsense_t");
});

Deno.test("function pointer typedefs become addresses", () => {
  const m = mapType("SteamAPIWarningMessageHook_t", ctx);
  assertEquals([m.kind, m.native, m.size], ["pointer", "function", 8]);
  assertEquals(mapType("void (*)(void *)", ctx).native, "function");
});
