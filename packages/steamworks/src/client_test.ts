/**
 * Integration test. Runs only when STEAMWORKS_SDK_PATH is set AND the Steam client
 * is running and logged in. CI runners cannot satisfy that, so this is a local check.
 */
import { assert, assertEquals } from "jsr:@std/assert@1";
import { SteamClient } from "./client.ts";

const sdk = Deno.env.get("STEAMWORKS_SDK_PATH");

Deno.test({
  name: "SteamClient.init against Spacewar (480)",
  ignore: !sdk,
  fn() {
    const steam = SteamClient.init({ appId: 480, sdkPath: sdk });
    try {
      assertEquals(steam.utils.appId(), 480);
      assert(steam.user.steamId() > 0n);
      assert(steam.friends.personaName().length > 0);
      assert(steam.userStats.numAchievements() > 0);
    } finally {
      steam.shutdown();
    }
  },
});
