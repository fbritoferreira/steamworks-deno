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

Continuous integration runs type check, lint and tests on Linux, macOS and Windows. It also
downloads the Steamworks SDK from Valve on every push and, on Linux and Windows, checks every struct
layout against the runner's own C++ compiler, resolves every generated symbol in the redistributable
library, and diffs the committed bindings against the downloaded SDK's schema. No Steam client runs
on a runner, so the live checks remain the part only a human can do.

Still missing:

- the live half of verification on Linux and Windows: layouts and symbols are compiler- and
  library-checked in CI, but no Steam client has read them there yet
- the seven shared dedicated-server interfaces, against a real dedicated server's steamclient
- a successful decrypt against a live ticket: the bindings decrypt and check them now
  ([Encrypted app tickets](#encrypted-app-tickets)), but Spacewar's key is not ours, so the live
  test can only watch the wrong key fail
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

A dedicated server needs no desktop client: its libsteam_api loads a standalone `steamclient`
library, which steamcmd ships. `deno task verify --dedicated` — with UDP 27015 and 27016 free —
starts such a server for AppID 480, logs it on anonymously, and asserts the whole story: init, a
`SteamServersConnected_t` callback decoded through the server pipe, all nine interfaces answering,
the server's anonymous SteamID, and a refused call after shutdown. Put the steamclient files where
libsteam_api looks for them — the working directory on macOS, where steamcmd_osx.tar.gz unpacks
`steamclient.dylib` and its companions; `~/.steam/sdk64` on Linux, which
`steamcmd +login anonymous +download_depot 1007 1006` fills from Valve's own "Steamworks SDK
Redist"; the working directory on Windows too, since `LoadLibrary` searches it and it is where
`download_depot 1007 1004` drops `steamclient64.dll` beside the `tier0_s64.dll` and
`vstdlib_s64.dll` it depends on — and the same check runs in CI on Linux and Windows runners that
fetch the steamclient themselves. So the dedicated path is verified end to end on every push while
the partner cookie behind the SDK download is fresh, and the development-machine null behaviour
remains what the full local run asserts.

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
- **The live checks need a human; everything else runs in CI against a downloaded SDK.** The SDK
  licence forbids redistributing it, so CI downloads it from Valve on every run — authenticated by
  the `STEAMWORKS_PARTNER_COOKIE` repository secret, the `Cookie` header a logged-in browser sends
  to partner.steamgames.com — and stores nothing beyond the ephemeral runner disk. With the secret
  set, the layout check, the library check and `deno task gen:check` run on Linux and Windows; a new
  Steamworks SDK release turns the schema check red until the bindings are regenerated. The session
  token inside the cookie lives about a day and a runner cannot refresh it, so a stale or failing
  download skips the SDK checks with a notice: red in that workflow always means the bindings, never
  the credential. The live tests still need the SDK plus a running, logged-in Steam client, which no
  runner has: those run locally, gated on `STEAMWORKS_SDK_PATH`.

## Verifying on your platform

Continuous integration runs the offline half on every push. It downloads the SDK from Valve — the
download is authenticated by the `STEAMWORKS_PARTNER_COOKIE` repository secret, the `Cookie` header
a logged-in browser sends to partner.steamgames.com — and runs `deno task verify --offline` on
Linux, macOS and Windows: every struct size and field offset against the runner's own C++ compiler,
and every generated symbol resolved in the redistributable library, with a call into the library
that must answer rather than crash. It also diffs the committed bindings against the downloaded
SDK's schema, which turns red on a new Steamworks release until `deno task gen` regenerates them.
The SDK is never cached or stored anywhere beyond the ephemeral runner disk. A fork pull request,
which cannot see repository secrets, skips these checks with a notice instead of failing — and so
does an expired cookie, since the session token inside lives about a day and no runner can refresh
it.

A second CI job proves the dedicated-server path on a Linux runner, with no Steam client anywhere:
it fetches Valve's standalone steamclient anonymously through steamcmd and runs
`deno task verify --dedicated`, which initialises a real game server, logs it on anonymously to
Steam's server network, decodes the logon callback through the server pipe, and requires all nine
server interfaces to answer. It rides the same cookie-gated SDK download and skips the same way when
the cookie is stale.

The other half — the part a runner can never do, because no Steam client runs there — is one
command, with Steam running and logged in:

```sh
git clone https://github.com/fbritoferreira/steamworks-deno
cd steamworks-deno
export STEAMWORKS_SDK_PATH=/path/to/steamworks_sdk   # the folder holding public/
deno task verify
```

Besides Deno, the SDK and a running Steam client, the layout check needs a C++ compiler:

- **macOS:** Xcode's command-line tools (`xcode-select --install`) provide `clang++`.
- **Linux:** `clang++` or `g++`, whichever the distribution offers, or set `CXX` to another.
- **Windows:** LLVM's clang (`winget install LLVM.LLVM`), or set `CXX` to a clang-compatible
  compiler. MSVC is not supported; its flags differ.

The harness compiles with `CXX` when that variable is set, otherwise with the first of `clang++`,
`c++`, `g++` that compiles it, and the check's printed line names the compiler that ran.

The command checks every struct size and field offset against that compiler, connects to Steam as a
client, reads the achievement schema, and unlocks an achievement to confirm the callback decodes. It
then starts a dedicated game server — UDP 27015 and 27016 must be free — and checks its init, its
two interfaces, a callback pump, its identity, the documented null answer the seven client-shared
interfaces give on a development machine, and the refusal to call after shutdown. It prints one line
per check and exits non-zero on any failure.

**Verified so far:** the client path on macOS arm64, the dedicated-server path on macOS arm64 and
Linux x86_64 — including in CI, while the cookie is fresh. Struct layouts and library symbols are
compiler- and library-checked by CI on Linux, macOS and Windows with every push.

**Not yet verified:** the live client half on Linux and Windows — no logged-in Steam client has read
a callback there yet. If you run the command above on either, open an issue with the lines it
printed: a pass verifies the platform, and a fail is a bug worth seeing. A Windows dedicated server
is the one gap the dedicated checks have not closed; the steamclient it would need
(`steamclient64.dll`, from steamcmd's Windows depot) goes where the desktop client's would, and the
runner setup for it is future work.

## Repository layout

```
packages/steamworks/   the package published to JSR as @steamworks/deno
examples/demo/         CLI proof of concept against AppID 480
sdk/                   your local copy of the Steamworks SDK (gitignored)
```

## Development

```sh
deno task check    # type-check
deno task lint     # deno lint + fmt --check
deno task test     # unit tests; set STEAMWORKS_SDK_PATH to also run the live integration test
STEAMWORKS_SDK_PATH=$PWD/sdk deno task verify # the full run: the Steam client running and logged in
STEAMWORKS_SDK_PATH=$PWD/sdk deno task verify --offline # the SDK and a C++ compiler; no Steam client
STEAMWORKS_SDK_PATH=$PWD/sdk deno task verify --dedicated # the SDK, a standalone steamclient, and UDP 27015-27016 free
STEAMWORKS_SDK_PATH=$PWD/sdk deno task demo [--keep]
```

CI runs the offline and dedicated checks on every push, downloading the SDK from Valve; the full run
is the half only a machine with a logged-in Steam client can do.

`deno compile` users: pass `--include` with the platform library and resolve its path from
`import.meta.url`; see the Deno FFI docs. Deno issue #31218 tracks a Windows path bug there.

## Licence

MIT for this repository. The Steamworks SDK is licensed separately by Valve under the
[Steamworks SDK Access Agreement](https://partner.steamgames.com/documentation/sdk_access_agreement).
