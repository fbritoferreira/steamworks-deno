/**
 * Verifies these bindings against the machine they are running on.
 *
 * Continuous integration proves the code compiles and the unit tests pass on Linux, macOS
 * and Windows, but no runner has a Steam client, so nothing there proves a real callback
 * decodes correctly. This script does, and prints one verdict.
 *
 *   STEAMWORKS_SDK_PATH=/path/to/sdk deno task verify
 *
 * Needs the Steam client running and logged in, an SDK on disk, and clang for the layout
 * check. Exits non-zero if any check fails.
 */
import { fromFileUrl, join } from "@std/path";
import { PACK } from "./src/layout.ts";
import { SteamClient } from "./src/client.ts";

const sdk = Deno.env.get("STEAMWORKS_SDK_PATH");
const here = fromFileUrl(new URL(".", import.meta.url));

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];
function record(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "pass" : "FAIL"}  ${name.padEnd(34)} ${detail}`);
}

console.log(`Steamworks bindings verification`);
console.log(`platform ${Deno.build.os}/${Deno.build.arch}, struct packing ${PACK}\n`);

if (!sdk) {
  console.error("Set STEAMWORKS_SDK_PATH to an unzipped Steamworks SDK.");
  Deno.exit(2);
}

// 1. Struct layouts against the platform's own C compiler.
try {
  const build = join(here, "harness", ".build");
  await Deno.mkdir(build, { recursive: true });
  const exe = join(build, Deno.build.os === "windows" ? "layout_check.exe" : "layout_check");
  const cc = await new Deno.Command("clang++", {
    args: [
      "-std=c++17",
      "-Wno-invalid-offsetof",
      `-I${join(sdk, "public")}`,
      join(here, "gen", "layout_check.cpp"),
      "-o",
      exe,
    ],
    stderr: "piped",
    stdout: "null",
  }).output();
  if (!cc.success) throw new Error(new TextDecoder().decode(cc.stderr).split("\n")[0]);

  const run = await new Deno.Command(exe, { stdout: "piped" }).output();
  const text = new TextDecoder().decode(run.stdout);
  const table = JSON.parse(await Deno.readTextFile(join(here, "gen", "layout.json")));
  const expected = table.pack[String(PACK)] as Record<
    string,
    { size: number; fields: Record<string, number> }
  >;

  let compared = 0;
  const bad: string[] = [];
  for (const line of text.split("\n")) {
    const size = /^(\w+) size=(\d+)$/.exec(line);
    if (size) {
      compared++;
      if (expected[size[1]]?.size !== Number(size[2])) {
        bad.push(`${size[1]} size ${expected[size[1]]?.size} computed, ${size[2]} real`);
      }
      continue;
    }
    const off = /^\s+(\w+)\.(\w+) off=(\d+)$/.exec(line);
    if (off) {
      compared++;
      if (expected[off[1]]?.fields[off[2]] !== Number(off[3])) {
        bad.push(
          `${off[1]}.${off[2]} offset ${expected[off[1]]?.fields[off[2]]} computed, ${off[3]} real`,
        );
      }
    }
  }
  record(
    "struct layouts vs C compiler",
    bad.length === 0 && compared > 500,
    bad.length === 0 ? `${compared} sizes and offsets agree` : bad.slice(0, 3).join("; "),
  );
} catch (e) {
  record("struct layouts vs C compiler", false, (e as Error).message);
}

// 2 onwards need a live Steam client.
let steam: SteamClient | undefined;
try {
  steam = SteamClient.init({ appId: 480, sdkPath: sdk });
  record("SteamAPI_InitFlat", true, "connected to the Steam client");
} catch (e) {
  record("SteamAPI_InitFlat", false, (e as Error).message);
}

if (steam) {
  try {
    const id = steam.user.getSteamID();
    const name = steam.friends.getPersonaName();
    record("interface accessors", id > 0n && name.length > 0, `${name}, ${id}`);
  } catch (e) {
    record("interface accessors", false, (e as Error).message);
  }

  try {
    const count = steam.userStats.getNumAchievements();
    record("achievement schema", count > 0, `${count} achievements for AppID 480`);
  } catch (e) {
    record("achievement schema", false, (e as Error).message);
  }

  // A callback decoded on this platform's struct layout: the check CI cannot do.
  try {
    const ACH = "ACH_WIN_ONE_GAME";
    const before = steam.userStats.getAchievement(ACH).pbAchieved;
    if (before) {
      steam.userStats.clearAchievement(ACH);
      steam.userStats.storeStats();
      for (let i = 0; i < 60; i++) {
        steam.runCallbacks();
        await new Promise((r) => setTimeout(r, 16));
      }
    }

    const seen = await new Promise<string | undefined>((resolve) => {
      let name: string | undefined;
      steam!.onCallback("UserAchievementStored", (data) => {
        name = data.m_rgchAchievementName;
      });
      steam!.userStats.setAchievement(ACH);
      steam!.userStats.storeStats();
      let frames = 0;
      const tick = () => {
        steam!.runCallbacks();
        if (name || ++frames > 300) resolve(name);
        else setTimeout(tick, 16);
      };
      tick();
    });

    record(
      "callback decoded on this platform",
      seen === ACH,
      seen ? `UserAchievementStored_t carried ${seen}` : "no callback arrived within 5 seconds",
    );

    steam.userStats.clearAchievement(ACH);
    steam.userStats.storeStats();
    for (let i = 0; i < 30; i++) {
      steam.runCallbacks();
      await new Promise((r) => setTimeout(r, 16));
    }
  } catch (e) {
    record("callback decoded on this platform", false, (e as Error).message);
  }

  steam.shutdown();
}

const failed = checks.filter((c) => !c.ok);
console.log(
  `\n${
    checks.length - failed.length
  } of ${checks.length} checks passed on ${Deno.build.os}/${Deno.build.arch}.`,
);
if (failed.length > 0) {
  console.log("Failed: " + failed.map((c) => c.name).join(", "));
  Deno.exit(1);
}
console.log("These bindings are verified on this platform.");
