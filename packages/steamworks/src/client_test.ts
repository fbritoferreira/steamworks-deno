/**
 * Live check against a running Steam client, using the generated bindings.
 * Runs only when STEAMWORKS_SDK_PATH is set and Steam is running and logged in,
 * which no CI runner offers.
 */
import { assert, assertEquals } from "@std/assert";
import { SteamClient } from "./client.ts";
import { CallbackId } from "../gen/callback_ids.ts";

const sdk = Deno.env.get("STEAMWORKS_SDK_PATH");

Deno.test({
  name: "the generated interfaces talk to Spacewar (AppID 480)",
  ignore: !sdk,
  fn() {
    const steam = SteamClient.init({ appId: 480, sdkPath: sdk });
    try {
      assertEquals(steam.utils.getAppID(), 480);
      assert(steam.user.getSteamID() > 0n, "a logged-in user has a SteamID");
      assert(steam.friends.getPersonaName().length > 0, "a logged-in user has a persona name");

      const count = steam.userStats.getNumAchievements();
      assert(count > 0, "the achievement schema loads during init");
      const first = steam.userStats.getAchievementName(0);
      assert(first.length > 0);
      // getAchievement reports both the call's success and the unlocked flag.
      const state = steam.userStats.getAchievement(first);
      assertEquals(typeof state.ok, "boolean");
      assertEquals(typeof state.pbAchieved, "boolean");

      assertEquals(steam.runCallbacks() >= 0, true);
      assertEquals(CallbackId.UserStatsStored, 1102);

      // Interfaces that had no getter before the base class was generated.
      assertEquals(typeof steam.screenshots.hookScreenshots, "function");
      assertEquals(typeof steam.http.createHTTPRequest, "function");
      assertEquals(typeof steam.inventory.getAllItems, "function");
      assertEquals(typeof steam.timeline.setTimelineTooltip, "function");
      assert(steam.remotePlay.getSessionCount() >= 0);
      assert(steam.networkingUtils.getLocalTimestamp() > 0n);
    } finally {
      steam.shutdown();
    }
  },
});
