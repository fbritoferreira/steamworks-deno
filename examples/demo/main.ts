/**
 * Proof of concept: talk to a running Steam client from Deno via FFI.
 *
 *   STEAMWORKS_SDK_PATH=./sdk deno task demo [--keep]
 *
 * Uses AppID 480 (Spacewar), Valve's public test app. Unlocks ACH_WIN_ONE_GAME,
 * waits for the store callbacks, fetches global percentages through a CallResult,
 * then clears the achievement again unless --keep is passed.
 */
import { callbacks, SteamClient } from "@steamworks/deno";

const keep = Deno.args.includes("--keep");
const ACH = "ACH_WIN_ONE_GAME";

const steam = SteamClient.init({ appId: 480 });
const stopPump = steam.startPump(16);
steam.onAny((id) => {
  if (
    id !== callbacks.CallbackId.UserStatsStored && id !== callbacks.CallbackId.UserAchievementStored
  ) {
    console.log(`   (callback ${id})`);
  }
});

try {
  console.log("library     :", steam.libraryPath);
  console.log("steamId     :", steam.user.steamId().toString());
  console.log("persona     :", steam.friends.personaName());
  console.log("appId/build :", steam.utils.appId(), "/", steam.apps.buildId());
  console.log("country/lang:", steam.utils.ipCountry(), "/", steam.utils.uiLanguage());
  console.log("overlay     :", steam.utils.overlayEnabled() ? "enabled" : "disabled");
  console.log("subscribed  :", steam.apps.isSubscribed());

  console.log("\nachievements:");
  for (const a of steam.userStats.listAchievements()) {
    console.log(`  ${a.achieved ? "[x]" : "[ ]"} ${a.apiName.padEnd(22)} ${a.displayName}`);
  }

  // --- unsolicited callbacks -------------------------------------------------
  const stored = new Promise<void>((resolve) => {
    let statsDone = false;
    let achDone = false;
    const check = () => statsDone && achDone && resolve();
    steam.on(callbacks.CallbackId.UserStatsStored, (b) => {
      const m = callbacks.decodeUserStatsStored(b);
      console.log(`\n<- UserStatsStored_t   gameId=${m.gameId} result=${m.result}`);
      statsDone = true;
      check();
    });
    steam.on(callbacks.CallbackId.UserAchievementStored, (b) => {
      const m = callbacks.decodeUserAchievementStored(b);
      console.log(
        `<- UserAchievementStored_t ${m.achievementName} ${m.curProgress}/${m.maxProgress}`,
      );
      achDone = true;
      check();
    });
  });

  const wasAchieved = steam.userStats.isAchieved(ACH);
  if (wasAchieved) {
    console.log(`\n${ACH} already unlocked; clearing first so the demo can unlock it.`);
    steam.userStats.clearAchievement(ACH);
    steam.userStats.storeStats();
    await sleep(500);
  }

  console.log(`\n-> SetAchievement(${ACH}) + StoreStats()`);
  const setOk = steam.userStats.setAchievement(ACH);
  const storeOk = steam.userStats.storeStats();
  console.log(`   SetAchievement=${setOk} StoreStats=${storeOk}`);
  if (!setOk || !storeOk) throw new Error("Steam rejected SetAchievement/StoreStats");
  await withTimeout(stored, 5000, "waiting for UserStatsStored_t/UserAchievementStored_t");
  console.log("achieved now:", steam.userStats.isAchieved(ACH));

  // --- CallResult --------------------------------------------------------------
  console.log("\n-> RequestGlobalAchievementPercentages() (CallResult)");
  const pct = await withTimeout(
    steam.userStats.requestGlobalAchievementPercentages(),
    5000,
    "GlobalAchievementPercentagesReady_t",
  );
  console.log(`<- GlobalAchievementPercentagesReady_t result=${pct.result}`);
  for (const a of steam.userStats.listAchievements()) {
    const p = steam.userStats.achievedPercent(a.apiName);
    console.log(`  ${a.apiName.padEnd(22)} ${p === null ? "n/a" : p.toFixed(1) + "%"}`);
  }

  if (!keep) {
    console.log(`\n-> ClearAchievement(${ACH}) (pass --keep to skip)`);
    steam.userStats.clearAchievement(ACH);
    steam.userStats.storeStats();
    await sleep(500);
  }
  console.log("\nPOC OK");
} finally {
  stopPump();
  steam.shutdown();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out ${what}`)), ms)),
  ]);
}
