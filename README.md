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

Working, and verified on macOS arm64 against a running Steam client:

- all 25 interfaces Steam hands a client, reachable from `SteamClient`
- callbacks delivered decoded by name, or as raw bytes if you prefer
- call results returned as promises
- a binary built with `deno compile` loads its embedded library and talks to Steam

The game-server path has the same shape through `SteamGameServerClient`: nine interfaces, manual
dispatch, decoded callbacks, call results as promises. `ISteamGameServer` and
`ISteamGameServerStats` are verified on a development machine. The seven interfaces a server shares
with a client need a real dedicated server to reach and are unverified; see
[Dedicated game servers](#dedicated-game-servers) for which and why.

Continuous integration runs type check, lint and tests on Linux, macOS and Windows. The Windows
struct layouts are computed and checked against a C compiler, but no Steam client has read them
there yet.

Still missing:

- live verification on Linux and Windows, against a real Steam client on each
- the seven shared dedicated-server interfaces, against a real dedicated server's steamclient
- decrypting an encrypted app ticket: the bindings fetch the bytes, making sense of them is still
  yours
- the [known limitations](#known-limitations) below

What shipped in each tagged release is in the [changelog](CHANGELOG.md).

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

### Two things about `deno compile` worth knowing

An included file keeps the path it had when you included it. A library included from a temporary
directory does not land beside your module, so `import.meta.url` will not find it. Copy it next to
the module first.

An embedded library can be opened but not inspected: it lives in the binary's virtual file system,
so `Deno.statSync` reports it missing while `Deno.dlopen` loads it. Code that checks the file exists
before opening it rejects exactly the case that matters. Try the open and catch the failure instead.

Library lookup order: `libraryPath` option, `sdkPath` option, `STEAMWORKS_LIB_PATH`,
`STEAMWORKS_SDK_PATH`.

## Dedicated game servers

A server is not a client: it initialises through its own entry point, gets its own set of
interfaces, and pumps its own callback queue.

```ts
import { ServerMode, SteamGameServerClient } from "@steamworks/deno";

const server = SteamGameServerClient.init({
  appId: 480,
  gamePort: 27015,
  queryPort: 27016,
  serverMode: ServerMode.Authentication,
  versionString: "1.0.0.0",
});

server.gameServer.setServerName("My server");
server.gameServer.logOnAnonymous();

// Once per tick, as a client does once per frame.
server.runCallbacks();

server.shutdown();
```

Nine interfaces are reachable, each through its game server accessor rather than the client one,
since `SteamAPI_SteamGameServerHTTP_v003` and `SteamAPI_SteamHTTP_v003` are different exports that
return different pointers.

`ISteamGameServer` and `ISteamGameServerStats` work anywhere a server starts. The seven a server
shares with a client, among them HTTP, UGC and the networking interfaces, are reached through a
dedicated server's own steamclient library. On a development machine running the Steam client they
return null, and the accessor error names which one failed.

## Encrypted app tickets

`ISteamUser` can hand you a ticket encrypted with your app's secret key, and a second library in the
SDK — `sdkencryptedappticket` — decrypts and checks it. It ships in `public/steam/lib`, not in
`redistributable_bin`, and these bindings keep it just as separate from `SteamClient`: the library
never talks to the Steam client, needs no `SteamAPI_Init`, and no Steam has to be running, so a
backend holding a ticket and your secret key can verify it with nothing else.

```ts
import { SteamClient, SteamEncryptedAppTicket } from "@steamworks/deno";

const steam = SteamClient.init({ appId: 480 });
const stop = steam.startPump();

// A call result: this promise settles during a later runCallbacks().
const ready = await steam.user.requestEncryptedAppTicket(new Uint8Array([1, 2, 3]), 3);

// Pull the encrypted bytes Steam has ready.
const buf = new Uint8Array(1024);
const pulled = steam.user.getEncryptedAppTicket(buf, buf.length);
if (!pulled.ok) throw new Error("no ticket ready"); // or the buffer was too small
const encrypted = buf.subarray(0, pulled.pcbTicket);

// Decrypt with YOUR app's secret key, from its Steamworks partner page.
const ticket = SteamEncryptedAppTicket.open();
const decrypted = ticket.decryptTicket(encrypted, secretKey32Bytes);
if (decrypted) {
  console.log(ticket.getTicketSteamID(decrypted)); // the user the ticket belongs to
  console.log(ticket.getTicketAppID(decrypted)); // the app it was issued for
}
ticket.close();

stop();
steam.shutdown();
```

The library loads the way the client one does: `libraryPath` option, `sdkPath` option,
`STEAMWORKS_TICKET_LIB_PATH`, `STEAMWORKS_SDK_PATH`.

One honest limit: only the app's owner can truly decrypt its tickets, because the secret key is
handed out on the app's own partner page. Spacewar is not ours, so nothing here has verified a
successful decrypt against a live ticket. The live test verifies everything around it: the ticket is
requested, arrives as a call result, comes back out as bytes, and the decrypt refuses the wrong key
— exactly what a ticket from an app you do not own must produce.

## Known limitations

- **Game coordinator messaging is unreachable, upstream.** `isteamgamecoordinator.h` ships in the
  SDK, but Valve's `steam_api.json` — the schema these bindings generate from — does not describe
  `ISteamGameCoordinator`, and the flat C API has no GameCoordinator entry points. There is nothing
  to bind until Valve publishes the interface; that is a gap in the schema Valve ships, not a bug
  here.
- **Everything that needs the SDK runs only on a machine that has it.** The SDK licence forbids
  redistributing it, so no CI runner ever holds a copy: the layout harness and the live tests skip
  themselves there, and `deno task gen:check` and `deno task verify` do not run at all. Binding
  drift — committed generated code that no longer matches the SDK — is only caught locally, where
  `STEAMWORKS_SDK_PATH` points at a real SDK (the layout harness also needs `clang`).

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
