/**
 * Proof that the generated bindings drive a real Steam client.
 *
 *   STEAMWORKS_SDK_PATH=./sdk deno task demo [--keep]
 *
 * Uses AppID 480, Valve's public Spacewar test app. Reads identity and app data, lists the
 * achievement schema, unlocks one achievement and waits for the two callbacks that confirm
 * it, resolves call results, asks for an encrypted app ticket and watches the decrypt refuse
 * a key that is not ours, then clears the achievement again unless --keep is passed.
 */
import { SteamClient, SteamEncryptedAppTicket } from "@steamworks/deno";

const keep = Deno.args.includes("--keep");
const ACH = "ACH_WIN_ONE_GAME";

const steam = SteamClient.init({ appId: 480 });
const stopPump = steam.startPump(16);

try {
  console.log("library     :", steam.libraryPath);
  console.log("steamId     :", steam.user.getSteamID().toString());
  console.log("persona     :", steam.friends.getPersonaName());
  console.log("appId/build :", steam.utils.getAppID(), "/", steam.apps.getAppBuildId());
  console.log("country/lang:", steam.utils.getIPCountry(), "/", steam.utils.getSteamUILanguage());
  console.log("game lang   :", steam.apps.getCurrentGameLanguage());
  console.log("overlay     :", steam.utils.isOverlayEnabled() ? "enabled" : "disabled");
  console.log("subscribed  :", steam.apps.bIsSubscribed());

  console.log("\nachievements:");
  const names: string[] = [];
  for (let i = 0; i < steam.userStats.getNumAchievements(); i++) {
    const apiName = steam.userStats.getAchievementName(i);
    names.push(apiName);
    const achieved = steam.userStats.getAchievement(apiName).pbAchieved;
    const label = steam.userStats.getAchievementDisplayAttribute(apiName, "name");
    console.log(`  ${achieved ? "[x]" : "[ ]"} ${apiName.padEnd(22)} ${label}`);
  }

  const stored = new Promise<void>((resolve) => {
    let statsDone = false;
    let achDone = false;
    const check = () => statsDone && achDone && resolve();
    steam.onCallback("UserStatsStored", (data) => {
      console.log(`\n<- UserStatsStored_t       gameId=${data.m_nGameID} result=${data.m_eResult}`);
      statsDone = true;
      check();
    });
    steam.onCallback("UserAchievementStored", (data) => {
      console.log(
        `<- UserAchievementStored_t ${data.m_rgchAchievementName} ${data.m_nCurProgress}/${data.m_nMaxProgress}`,
      );
      achDone = true;
      check();
    });
  });

  if (steam.userStats.getAchievement(ACH).pbAchieved) {
    console.log(`\n${ACH} is already unlocked; clearing it so the demo can unlock it.`);
    steam.userStats.clearAchievement(ACH);
    steam.userStats.storeStats();
    await sleep(500);
  }

  console.log(`\n-> SetAchievement(${ACH}) and StoreStats()`);
  const setOk = steam.userStats.setAchievement(ACH);
  const storeOk = steam.userStats.storeStats();
  console.log(`   SetAchievement=${setOk} StoreStats=${storeOk}`);
  if (!setOk || !storeOk) throw new Error("Steam rejected SetAchievement or StoreStats");
  await withTimeout(stored, 5000, "the two store callbacks");
  console.log("achieved now:", steam.userStats.getAchievement(ACH).pbAchieved);

  console.log("\n-> RequestGlobalAchievementPercentages(), a call result");
  const handle = steam.userStats.requestGlobalAchievementPercentages();
  const ready = await withTimeout(handle, 5000, "GlobalAchievementPercentagesReady_t");
  console.log(`<- GlobalAchievementPercentagesReady_t result=${ready.m_eResult}`);
  for (const apiName of names) {
    const pct = steam.userStats.getAchievementAchievedPercent(apiName);
    console.log(`  ${apiName.padEnd(22)} ${pct.ok ? pct.pflPercent.toFixed(1) + "%" : "n/a"}`);
  }

  // A ticket failure must not kill the demo before it clears the achievement again, so this
  // one segment prints its failure and carries on; everything above still throws to die.
  try {
    console.log("\n-> RequestEncryptedAppTicket(), a call result");
    const ready = await withTimeout(
      steam.user.requestEncryptedAppTicket(new Uint8Array([1, 2, 3]), 3),
      5000,
      "EncryptedAppTicketResponse_t",
    );
    console.log(`<- EncryptedAppTicketResponse_t result=${ready.m_eResult}`);

    let buf = new Uint8Array(1024);
    let pulled = steam.user.getEncryptedAppTicket(buf, buf.length);
    if (!pulled.ok && pulled.pcbTicket > 0) {
      buf = new Uint8Array(pulled.pcbTicket);
      pulled = steam.user.getEncryptedAppTicket(buf, buf.length);
    }
    if (!pulled.ok || pulled.pcbTicket === 0) throw new Error("no ticket bytes came back out");
    const encrypted = buf.subarray(0, pulled.pcbTicket);

    const ticket = SteamEncryptedAppTicket.open();
    try {
      const decrypted = ticket.decryptTicket(encrypted, new Uint8Array(32));
      if (decrypted === null) {
        console.log(
          `ticket      : ${encrypted.length} encrypted bytes arrived, and the decrypt refused ` +
            "the zero key — Spacewar's real key belongs to Valve, and only an app you own can " +
            "be truly decrypted",
        );
      } else {
        console.log(`ticket      : ${encrypted.length} bytes; a zero key decrypted them?!`);
      }
    } finally {
      ticket.close();
    }
  } catch (err) {
    console.log("ticket      : failed —", err instanceof Error ? err.message : err);
  }

  if (!keep) {
    console.log(`\n-> ClearAchievement(${ACH}); pass --keep to leave it unlocked`);
    steam.userStats.clearAchievement(ACH);
    steam.userStats.storeStats();
    await sleep(500);
  }
  console.log("\nGenerated bindings OK");
} finally {
  stopPump();
  steam.shutdown();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out waiting for ${what}`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
