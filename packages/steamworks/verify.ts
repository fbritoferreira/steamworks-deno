/**
 * Verifies these bindings against the machine they are running on.
 *
 * Continuous integration proves the code compiles and the unit tests pass on Linux, macOS
 * and Windows, but no runner has a Steam client, so nothing there proves a real callback
 * decodes correctly. This script does, and prints one verdict.
 *
 *   STEAMWORKS_SDK_PATH=/path/to/sdk deno task verify
 *
 * With `--offline` it runs everything that needs no Steam client: the layout check and the
 * library check that resolves every generated symbol and calls into the library once.
 * That is the half CI runs on every push, after downloading the SDK from Valve.
 *
 * Without it, the full run needs the Steam client running and logged in, and a C++
 * compiler for the layout check. Any clang- or g++-compatible driver will do: CXX is used
 * verbatim when set, otherwise clang++, c++ and g++ are tried in that order. MSVC is not —
 * its flags differ — so on Windows install LLVM's clang or point CXX at a clang-compatible
 * compiler. The server checks bind UDP 27015 and 27016, which must be free. Exits non-zero
 * on any failure.
 */
import { fromFileUrl, join } from "@std/path";
import { PACK } from "./src/layout.ts";
import { CORE_SYMBOLS, LibraryHandle, resolveLibraryPath } from "./src/lib.ts";
import { SteamInitResult } from "./src/errors.ts";
import { readFixedString } from "./src/cstring.ts";
import { ALL_INTERFACE_SYMBOLS } from "./gen/all_symbols.ts";
import { SteamClient } from "./src/client.ts";
import { ServerMode, SteamGameServerClient } from "./src/game_server.ts";

const sdk = Deno.env.get("STEAMWORKS_SDK_PATH");
const offline = Deno.args.includes("--offline");
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

/**
 * Compile the layout harness, and report which compiler did it.
 *
 * The first candidate that compiles the harness wins, so a machine needs any one C++
 * compiler rather than clang specifically. A compiler that runs but fails contributes its
 * first error line; one that is not installed is skipped quietly.
 */
async function compileHarness(candidates: readonly string[], args: string[]): Promise<string> {
  let compileError = "";
  for (const compiler of candidates) {
    try {
      const cc = await new Deno.Command(compiler, { args, stderr: "piped", stdout: "null" })
        .output();
      if (cc.success) return compiler;
      compileError ||= `${compiler}: ${new TextDecoder().decode(cc.stderr).split("\n")[0]}`;
    } catch {
      // Not installed on this machine; try the next candidate.
    }
  }
  throw new Error(compileError || `no C++ compiler found; tried ${candidates.join(", ")}`);
}

console.log(`Steamworks bindings verification`);
console.log(`platform ${Deno.build.os}/${Deno.build.arch}, struct packing ${PACK}\n`);

if (!sdk) {
  console.error("Set STEAMWORKS_SDK_PATH to an unzipped Steamworks SDK.");
  Deno.exit(2);
}

// 1. Struct layouts against the platform's own C++ compiler.
try {
  const build = join(here, "harness", ".build");
  await Deno.mkdir(build, { recursive: true });
  const exe = join(build, Deno.build.os === "windows" ? "layout_check.exe" : "layout_check");
  const cxx = Deno.env.get("CXX");
  const compiler = await compileHarness(cxx ? [cxx] : ["clang++", "c++", "g++"], [
    "-std=c++17",
    "-Wno-invalid-offsetof",
    `-I${join(sdk, "public")}`,
    join(here, "gen", "layout_check.cpp"),
    "-o",
    exe,
  ]);

  const run = await new Deno.Command(exe, { stdout: "piped" }).output();
  if (!run.success) throw new Error(`the layout harness exited ${run.code}`);
  // The Windows C runtime writes \r\n; without stripping it every line ends in \r and
  // no regex matches, which once read as "0 sizes and offsets agree".
  const text = new TextDecoder().decode(run.stdout).replaceAll("\r", "");
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
    bad.length === 0
      ? `${compared} sizes and offsets agree (${compiler})`
      : bad.slice(0, 3).join("; "),
  );
} catch (e) {
  record("struct layouts vs C compiler", false, (e as Error).message);
}

// 2. Offline: the library itself. Every generated symbol must resolve in the platform's
// redistributable library, and calling into it must answer rather than crash, Steam client
// or not. CI runs exactly this on every push.
if (offline) {
  try {
    const symbols = { ...CORE_SYMBOLS, ...ALL_INTERFACE_SYMBOLS } as const;
    const handle = new LibraryHandle(resolveLibraryPath({ sdkPath: sdk }));
    const lib = handle.open(symbols);
    const running = lib.symbols.SteamAPI_IsSteamRunning();
    const errBuf = new Uint8Array(1024);
    const result = lib.symbols.SteamAPI_InitFlat(errBuf) as SteamInitResult;
    if (result === SteamInitResult.OK) lib.symbols.SteamAPI_Shutdown();
    const why = readFixedString(errBuf, 0, errBuf.length).split("\n")[0];
    record(
      "library opens, symbols resolve",
      result in SteamInitResult,
      `${Object.keys(symbols).length} symbols; IsSteamRunning()=${running}; ` +
        `InitFlat answered ${SteamInitResult[result]}${why ? `: ${why}` : ""}`,
    );
    handle.closeAll();
  } catch (e) {
    record("library opens, symbols resolve", false, (e as Error).message);
  }

  finish();
}

// 3 onwards need a live Steam client.
if (!offline) {
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
}

// 4. The dedicated-server path, which the client checks above never exercise.
if (!offline) {
  let server: SteamGameServerClient | undefined;
  try {
    server = SteamGameServerClient.init({
      appId: 480,
      gamePort: 27015,
      queryPort: 27016,
      serverMode: ServerMode.NoAuthentication,
      versionString: "1.0.0.0",
      sdkPath: sdk,
    });
    record("game server init", true, "SteamInternal_GameServer_Init_V2 connected");
  } catch (e) {
    record(
      "game server init",
      false,
      `${(e as Error).message} (the init binds UDP 27015 and 27016, which must be free)`,
    );
  }

  if (server) {
    const sv = server;
    try {
      sv.gameServer.setServerName("steamworks-deno verify");
      const stats = sv.gameServerStats;
      record(
        "server interfaces",
        typeof stats.setUserStatInt32 === "function",
        "ISteamGameServer and ISteamGameServerStats answer",
      );
    } catch (e) {
      record("server interfaces", false, (e as Error).message);
    }

    try {
      const drained = sv.runCallbacks();
      record("server callbacks", drained >= 0, `${drained} callbacks drained on the server pipe`);
    } catch (e) {
      record("server callbacks", false, (e as Error).message);
    }

    try {
      const id = sv.steamId();
      const secure = sv.isSecure();
      record(
        "server identity",
        typeof id === "bigint" && typeof secure === "boolean",
        `${id}, ${secure ? "secure" : "not secure"}`,
      );
    } catch (e) {
      record("server identity", false, (e as Error).message);
    }

    // The seven interfaces a server shares with a client answer null on a development machine —
    // the documented behaviour, see the README — so that is what this check asserts: every one
    // refuses, and each refusal names its SteamAPI_SteamGameServer* accessor.
    try {
      const shared: Array<[name: string, accessor: string, reach: () => unknown]> = [
        ["ISteamHTTP", "SteamAPI_SteamGameServerHTTP_v003", () => sv.http],
        ["ISteamInventory", "SteamAPI_SteamGameServerInventory_v003", () => sv.inventory],
        ["ISteamNetworking", "SteamAPI_SteamGameServerNetworking_v006", () => sv.networking],
        [
          "ISteamNetworkingMessages",
          "SteamAPI_SteamGameServerNetworkingMessages_SteamAPI_v002",
          () => sv.networkingMessages,
        ],
        [
          "ISteamNetworkingSockets",
          "SteamAPI_SteamGameServerNetworkingSockets_SteamAPI_v013",
          () => sv.networkingSockets,
        ],
        ["ISteamUGC", "SteamAPI_SteamGameServerUGC_v021", () => sv.ugc],
        ["ISteamUtils", "SteamAPI_SteamGameServerUtils_v011", () => sv.utils],
      ];
      const answered: string[] = [];
      const misnamed: string[] = [];
      let refused = 0;
      for (const [name, accessor, reach] of shared) {
        try {
          reach();
          answered.push(name);
        } catch (e) {
          if ((e as Error).message.includes(accessor)) refused++;
          else misnamed.push(`${name} refused without naming its accessor ${accessor}`);
        }
      }
      record(
        "shared server interfaces on a dev machine",
        answered.length === 0 && misnamed.length === 0,
        misnamed[0] ??
          (answered.length > 0
            ? `${answered.join(", ")} answered; the documented answer on a dev machine is null`
            : `${refused} of ${shared.length} refused, each naming its accessor — the documented behaviour`),
      );
    } catch (e) {
      record("shared server interfaces on a dev machine", false, (e as Error).message);
    }

    try {
      sv.shutdown();
      let refusal = "";
      try {
        sv.steamId();
      } catch (e) {
        refusal = (e as Error).message;
      }
      record(
        "server shutdown",
        refusal.includes("shut down"),
        refusal.includes("shut down")
          ? "a call after shutdown was refused"
          : `${refusal || "no refusal"} after shutdown`,
      );
    } catch (e) {
      record("server shutdown", false, (e as Error).message);
    }
  }
}

finish();

/** Print the summary and exit by the results. */
function finish(): never {
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
  Deno.exit(0);
}
