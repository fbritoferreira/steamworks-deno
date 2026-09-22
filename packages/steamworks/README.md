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

Early but working. Verified on macOS against a running Steam client:

- `SteamAPI_InitFlat`, shutdown, and manual callback dispatch
- identity, friends, app and achievement data through the generated interfaces
- unsolicited callbacks delivered to listeners by id
- call results surfaced as promises

Continuous integration covers Linux, macOS and Windows.

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
import { callbacks, SteamClient } from "@steamworks/deno";

const steam = SteamClient.init({ appId: 480 }); // 480 = Spacewar, Valve's test app
const stop = steam.startPump(16); // or call steam.runCallbacks() from your game loop

console.log(steam.friends.personaName(), steam.user.steamId());

steam.on(callbacks.CallbackId.UserAchievementStored, (bytes) => {
  console.log("stored", callbacks.decodeUserAchievementStored(bytes).achievementName);
});
steam.userStats.setAchievement("ACH_WIN_ONE_GAME");
steam.userStats.storeStats();

const pct = await steam.userStats.requestGlobalAchievementPercentages(); // CallResult -> Promise

stop();
steam.shutdown();
```

Run with `deno run --allow-ffi --allow-env --allow-read main.ts`.

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
