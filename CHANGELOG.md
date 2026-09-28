# Changelog

Every tagged release is a workspace release: @steamworks/deno and @steamworks/codegen build from the
same commit and carry the same version number, so an entry below moved both packages even when it
only describes one.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Content is derived from
the release tags, their commits and the pull requests that carried them.

## [0.5.0] - 2026-09-28

Encrypted app tickets, decrypted and checked (#6), with the status section made truthful and a
changelog added (#7), and verification that runs anywhere (#8).

### Added

- `SteamEncryptedAppTicket`: bindings for the SDK's separate `sdkencryptedappticket` library, which
  decrypts and checks the ticket `ISteamUser.requestEncryptedAppTicket` produces. The library never
  talks to the Steam client, so a backend holding a ticket and the app's secret key can verify it
  with nothing else running. It resolves like the client library does (`libraryPath`, `sdkPath`,
  `STEAMWORKS_TICKET_LIB_PATH`, `STEAMWORKS_SDK_PATH`) and refuses calls after `close`. The live
  test asserts the honest result on AppID 480: a ticket requested, arrived and pulled as bytes, and
  a decrypt that refuses a key its app does not own.
- `CHANGELOG.md`, this file, covering every release from v0.0.1, and a Known limitations section in
  the README: game coordinator messaging is unreachable upstream, and everything that needs the SDK
  runs only on a machine that has it.

### Changed

- `deno task verify` selects a C++ compiler — `CXX` if set, then `clang++`, `c++`, `g++` — instead
  of requiring clang, and names the one it used. It also verifies the dedicated-server path now:
  init, the two server-only interfaces, the callback pipe, server identity, and the documented null
  behaviour of the seven shared interfaces on a development machine.
- The README's Status section states what 0.4.0 ships instead of listing finished work as roadmap,
  and "Verifying on your platform" carries per-OS prerequisites.

## [0.4.0] - 2026-09-23

Dedicated game server support (#5), with a raylib demo game alongside it (#4).

### Added

- `SteamGameServerClient` and `ServerMode`: a server initialises through
  `SteamInternal_GameServer_Init_V2`, reaches its own nine interfaces through their game server
  accessors, and pumps its own callback queue. `ISteamGameServer` and `ISteamGameServerStats` are
  verified on a development machine; the seven interfaces a server shares with a client need a real
  dedicated server.
- `examples/game`: a raylib game that talks to Steam while it runs — score a point, an achievement
  unlocks, the decoded callback lands on screen a frame or two later. Runs as a standalone binary
  with no SDK and no raylib installed.
- The server init checks ten interface version strings, generated from the schema rather than
  written out by hand, so an SDK mismatch surfaces at init instead of at the first call.

### Changed

- `SteamInitError` names the entry point that failed; a client and a server use different ones, and
  the old message always said `SteamAPI_InitFlat`.

### Fixed

- A library resolver that checked a file existed before opening it rejected exactly the embedded
  case `deno compile` produces, where `Deno.statSync` reports missing but `Deno.dlopen` loads.
  Resolvers now try the open and catch the failure instead.

## [0.3.0] - 2026-09-23

Refuse calls after shutdown instead of crashing the process (#3).

### Fixed

- Reaching an interface after `shutdown` called through a pointer into a closed library and crashed
  the process with SIGSEGV. Every accessor now checks first and throws, the interface cache is
  cleared on shutdown, and `isRunning` reports the state.
- A call result Steam never completes stayed pending for the life of the process. It is now rejected
  after two minutes, tunable with `callResultTimeoutMs`, and the deadline timer is unreffed so a
  pending call result never holds the process open.

### Added

- `isConnected`, following `SteamServersConnected_t`, `SteamServersDisconnected_t`,
  `SteamShutdown_t` and `IPCFailure_t`; calls keep working when it goes false.
- `isSteamRunning` and `releaseCurrentThreadMemory`, which sat in the symbol table with no way to
  reach them.

## [0.2.2] - 2026-09-23

### Added

- @steamworks/codegen only: every export documented, the schema types included, and the package got
  its own README with runnable examples.

## [0.2.1] - 2026-09-23

Publishing 0.2.0 uploaded @steamworks/deno, then exited non-zero on a provenance step, so
@steamworks/codegen was never published.

### Fixed

- The publish workflow publishes each package independently and confirms both versions against the
  registry rather than trusting one CLI exit code, and waits for the registry to index a new version
  before checking.

## [0.2.0] - 2026-09-23

Documentation for every symbol, and one-command platform verification (#2).

### Added

- Documentation for every exported symbol in both packages, harvested from the SDK headers because
  `steam_api.json` describes almost nothing. JSR shows the descriptions and the documentation score
  stops reporting 1.5 percent.
- `deno task verify`: one command that checks every struct size and field offset against the local C
  compiler, connects to Steam, and unlocks an achievement to prove a real callback decodes. The
  unverified-platform gap becomes one command on hardware someone has.

### Fixed

- The header scanner anchored its regexes on end of line, which matched nothing against the SDK's
  CRLF headers and left field comments empty; the packing scanner carried the same latent defect.

## [0.1.0] - 2026-09-23

Runtime completeness: compiled binaries, every interface, decoded callbacks (#1).

### Fixed

- Inside a compiled binary, each `Deno.dlopen` of an embedded library extracts its own copy, so the
  second open returned an instance where `SteamAPI_InitFlat` had never run and every interface
  accessor answered null — a defect that would have broken every compiled game while staying
  invisible in development. The library is now opened once with all 948 symbols, and `LibraryHandle`
  throws on a second open.

### Added

- All 25 client interfaces reachable through `SteamClient`, generated: nine hand-written getters
  became twenty-five. Screenshots, HTTP, inventory, timeline, remote play, parties and the
  networking interfaces became reachable.
- `onCallback("UserAchievementStored", data => ...)`: callbacks arrive decoded, typed by a generated
  name-to-type map. `on(id, bytes => ...)` keeps the raw bytes.

### Changed

- The README examples compile again; they called accessors that never existed.

## [0.0.2] - 2026-09-23

### Fixed

- The generator refuses an SDK whose version it cannot read, instead of baking "unknown" into every
  generated file — the value a version mismatch reports to users. 0.0.1 shipped with it.

## [0.0.1] - 2026-09-23

First release: Deno FFI bindings for the Steamworks SDK, generated from Valve's `steam_api.json`.

### Added

- @steamworks/codegen: loads `steam_api.json`, maps its C types, derives struct packing from the SDK
  headers, and emits enums, consts, struct decoders, callback ids and typed wrappers over the flat
  API for all 34 interfaces of SDK 1.65.
- @steamworks/deno: `SteamClient` over the generated interfaces with nine hand-written accessors,
  manual callback dispatch, and a live check against a running Steam client.
- CI on Linux, macOS and Windows, and JSR publishing on a version tag through GitHub's OIDC
  provider, with the tag and the package version required to agree.

[0.4.0]: https://github.com/fbritoferreira/steamworks-deno/releases/tag/v0.4.0
[0.3.0]: https://github.com/fbritoferreira/steamworks-deno/releases/tag/v0.3.0
[0.2.2]: https://github.com/fbritoferreira/steamworks-deno/releases/tag/v0.2.2
[0.2.1]: https://github.com/fbritoferreira/steamworks-deno/releases/tag/v0.2.1
[0.2.0]: https://github.com/fbritoferreira/steamworks-deno/releases/tag/v0.2.0
[0.1.0]: https://github.com/fbritoferreira/steamworks-deno/releases/tag/v0.1.0
[0.0.2]: https://github.com/fbritoferreira/steamworks-deno/releases/tag/v0.0.2
[0.0.1]: https://github.com/fbritoferreira/steamworks-deno/releases/tag/v0.0.1
