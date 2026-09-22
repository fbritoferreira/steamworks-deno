# @steamworks/deno

Deno FFI bindings for the [Steamworks SDK](https://partner.steamgames.com/doc/sdk), so games built
with Deno and shipped with `deno compile` can talk to the Steam client: achievements, stats, user
identity, overlay, and the rest of the flat C API.

> **Not affiliated with Valve.** This is an independent community project. "Steam" and "Steamworks"
> are trademarks of Valve Corporation. This repository and the published package contain no Valve
> code or binaries.

[![JSR](https://jsr.io/badges/@steamworks/deno)](https://jsr.io/@steamworks/deno)
[![ci](https://github.com/fbritoferreira/steamworks-deno/actions/workflows/ci.yml/badge.svg)](https://github.com/fbritoferreira/steamworks-deno/actions/workflows/ci.yml)

## Status

Working, and verified on macOS against a running Steam client:

- all 25 interfaces Steam hands a client, reachable from `SteamClient`
- callbacks delivered decoded by name, or as raw bytes if you prefer
- call results returned as promises
- a binary built with `deno compile` loads its embedded library and talks to Steam

Continuous integration runs type check, lint and tests on Linux, macOS and Windows. The Windows
struct layouts are computed and checked against a C compiler, but no Steam client has read them
there yet.

Everything else is on the roadmap: generated bindings for all 34 interfaces from `steam_api.json`,
per-platform struct layouts (Windows packs callback structs at 8 bytes, macOS/Linux at 4), Linux and
Windows CI, a raylib demo game, JSR publish.

## Requirements

1. Deno 2.3 or newer.
2. The Steam client running and logged in.
3. The Steamworks SDK, downloaded by you from
   <https://partner.steamgames.com/downloads/steamworks_sdk.zip> (needs a Steamworks account). The
   SDK licence does not permit redistributing it, so this package never bundles it.

## Getting started

```sh
unzip steamworks_sdk_165.zip -d /some/where    # contains sdk/redistributable_bin and sdk/public
export STEAMWORKS_SDK_PATH=/some/where/sdk
```

```ts
import { SteamClient } from "@steamworks/deno";

const steam = SteamClient.init({ appId: 480 }); // 480 is Spacewar, Valve's test app
const stop = steam.startPump(16); // or call steam.runCallbacks() from your game loop

console.log(steam.friends.getPersonaName(), steam.user.getSteamID());

steam.onCallback("UserAchievementStored", (data) => {
  console.log("stored", data.m_rgchAchievementName);
});
steam.userStats.setAchievement("ACH_WIN_ONE_GAME");
steam.userStats.storeStats();

// A call result comes back as a promise, resolved by a later runCallbacks().
const ready = await steam.userStats.requestGlobalAchievementPercentages();
console.log(ready.m_eResult);

stop();
steam.shutdown();
```

Run with `deno run --allow-ffi --allow-env --allow-read main.ts`.

## Lifecycle

`SteamClient.init` opens the library and connects. `shutdown` closes both, and after it every
accessor refuses rather than calling into freed memory:

```ts
steam.shutdown();
steam.friends.getPersonaName(); // throws; before 0.3.0 this crashed the process
```

Two states are worth checking while a game runs:

```ts
steam.isRunning; // false once shutdown has run
steam.isConnected; // false when Steam reports the connection gone
```

`isConnected` follows `SteamServersDisconnected_t`, `SteamShutdown_t` and `IPCFailure_t`. Calls keep
working when it goes false, but anything needing Steam's servers will fail until it reconnects.

A call result Steam never completes is rejected after two minutes, since callbacks only arrive while
`runCallbacks` is being called. Change it with `callResultTimeoutMs`, or pass 0 to wait
indefinitely.

## Shipping with `deno compile`

Include the platform library and resolve it from your own module:

```ts
import { embeddedLibraryPath, SteamClient } from "@steamworks/deno";

const steam = SteamClient.init({
  appId: 480,
  libraryPath: embeddedLibraryPath(import.meta.url),
});
```

```sh
deno compile --allow-ffi --allow-env --allow-read \
  --include libsteam_api.dylib \
  --output mygame main.ts
```

Include the library for the target you build for, not the host: `libsteam_api.dylib` on macOS,
`libsteam_api.so` on Linux, `steam_api64.dll` on Windows.

Library lookup order: `libraryPath` option, `sdkPath` option, `STEAMWORKS_LIB_PATH`,
`STEAMWORKS_SDK_PATH`.

## Verifying on your platform

Continuous integration proves this compiles and the unit tests pass on Linux, macOS and Windows, but
no runner has a Steam client, so nothing there proves a real callback decodes correctly on that
platform.

One command does, with Steam running and logged in:

```sh
git clone https://github.com/fbritoferreira/steamworks-deno
cd steamworks-deno
export STEAMWORKS_SDK_PATH=/path/to/steamworks_sdk   # the folder holding public/
deno task verify
```

It checks every struct size and field offset against your own C compiler, connects to Steam, reads
the achievement schema, and unlocks an achievement to confirm the callback decodes. It prints one
line per check and exits non-zero on any failure.

**Verified so far:** macOS on arm64.

**Not yet verified:** Linux and Windows. The struct layouts for both are computed and checked
against a C compiler, but no Steam client has read them there. If you run the command above on
either, the result is worth reporting in an issue.

## Repository layout

```
packages/steamworks/   the package published to JSR as @steamworks/deno
examples/demo/         CLI proof of concept against AppID 480
sdk/                   your local copy of the Steamworks SDK (gitignored)
```

## Development

```sh
deno task check   # type-check
deno task lint    # deno lint + fmt --check
deno task test    # unit tests; set STEAMWORKS_SDK_PATH to also run the live integration test
STEAMWORKS_SDK_PATH=$PWD/sdk deno task demo [--keep]
```

`deno compile` users: pass `--include` with the platform library and resolve its path from
`import.meta.url`; see the Deno FFI docs. Deno issue #31218 tracks a Windows path bug there.

## Licence

MIT for this repository. The Steamworks SDK is licensed separately by Valve under the
[Steamworks SDK Access Agreement](https://partner.steamgames.com/documentation/sdk_access_agreement).
