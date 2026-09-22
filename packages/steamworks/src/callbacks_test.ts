import { assertEquals } from "jsr:@std/assert@1";
import {
  decodeSteamAPICallCompleted,
  decodeUserAchievementStored,
  decodeUserStatsStored,
} from "./callbacks.ts";

Deno.test("decodeUserAchievementStored reads fixed char[128] and progress", () => {
  const bytes = new Uint8Array(152);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, 480n, true);
  bytes[8] = 0;
  bytes.set(new TextEncoder().encode("ACH_WIN_ONE_GAME"), 9);
  view.setUint32(140, 0, true);
  view.setUint32(144, 0, true);
  assertEquals(decodeUserAchievementStored(bytes), {
    gameId: 480n,
    groupAchievement: false,
    achievementName: "ACH_WIN_ONE_GAME",
    curProgress: 0,
    maxProgress: 0,
  });
});

Deno.test("decodeUserStatsStored", () => {
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, 480n, true);
  view.setInt32(8, 1, true);
  assertEquals(decodeUserStatsStored(bytes), { gameId: 480n, result: 1 });
});

Deno.test("decodeSteamAPICallCompleted", () => {
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, 0xdeadbeefn, true);
  view.setInt32(8, 1110, true);
  view.setUint32(12, 12, true);
  assertEquals(decodeSteamAPICallCompleted(bytes), {
    asyncCall: 0xdeadbeefn,
    callbackId: 1110,
    paramSize: 12,
  });
});
