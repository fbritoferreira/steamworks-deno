# Changelog

Every tagged release is a workspace release: @steamworks/deno and @steamworks/codegen build from the
same commit and carry the same version number, so an entry below moved both packages even when it
only describes one.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Content is derived from
the release tags, their commits and the pull requests that carried them.

## [0.6.1] - 2026-09-30

### Added

- The demo now walks the encrypted app ticket flow: request a ticket, pull its bytes, and watch the
  decrypt refuse a zero key — the honest result for an app whose secret key is not ours.

- AGENTS.md: the task commands, the three verify modes, the SDK's licence rule, what each workflow
  checks, and the repo's conventions, for agents and contributors alike.

### Changed

- The dedicated-server check runs on a Windows runner too: CI fetches depot 1004 anonymously, drops
  `steamclient64.dll` and its companions in the repo root and `~/.steam/sdk64`, and runs
  `deno task verify --dedicated` — the same end-to-end proof the Linux job already had.

- The SDK verification runs daily on a schedule, not only on push, so a quiet repository still
  notices when Valve ships a new Steamworks SDK. A schema-check failure opens a `[sdk-drift]` issue
  quoting the drift, and the first green schema check after it closes the issue itself — usually the
  regeneration PR's own run. The alarm has been fired for real once, on a deliberate sabotage run,
  and opened exactly the issue it should have. Ubuntu runners are pinned to ubuntu-24.04 ahead of
  GitHub's October migration.

- The layout check's comparison — the C++ harness's output against the generated layout table —
  moved out of `verify.ts` into `compareHarnessOutput`, exported and unit-tested. The Windows CRLF
  bug shipped precisely because that parsing lived where no test could reach it; the tests now pin
  LF and CRLF output, the exact mismatch wording the check prints, and the minimum-count guard that
  turns a run comparing almost nothing into a failure.

- `packages/steamworks/README.md` — the README JSR serves — had drifted from the repository's by 200
  lines and still told the pre-0.4.0 story. It is now a copy of the repository README, and CI fails
  when the two differ, so the package page cannot go stale again. The README also carries the
  sdk-verify badge alongside the ci one.

- Both packages declare their Deno floor in `deno.json` (`"deno": ">=2.3"`), which the README has
  always claimed.

## [0.6.0] - 2026-09-29

### Added

- `deno task verify --offline`: the half of verification that needs no Steam client — the
  struct-layout check against the machine's own C++ compiler, and a library check that resolves
  every generated symbol in the redistributable library and confirms a call into it answers
  gracefully with no client running.
- CI that downloads the Steamworks SDK from Valve on every push and verifies the bindings on Linux
  and Windows: the two checks above, plus `deno task gen:check` against the downloaded SDK's schema,
  which turns red on a new Steamworks release until the bindings are regenerated. The download is
  authenticated by the `STEAMWORKS_PARTNER_COOKIE` repository secret; a missing, stale or failing
  download skips with a notice — red is reserved for binding regressions — so fork pull requests and
  an expired cookie stay green. On Windows the layout harness now parses its output as CRLF: the
  first authenticated run there compared zero offsets because every line ended in a carriage return
  no regex matched.
- `deno task verify --dedicated`: the dedicated-server path, verified end to end. The mode runs the
  offline checks, then starts a real game server — AppID 480, anonymous logon, no desktop Steam
  client — using the standalone `steamclient` library steamcmd ships, placed where libsteam_api
  looks for it (the working directory on macOS, `~/.steam/sdk64` on Linux). It asserts init, a
  `SteamServersConnected_t` callback decoded through the server pipe on the machine's own struct
  layout, all nine server interfaces answering — the seven shared with a client included — the
  server's anonymous SteamID, and the refusal of a call after shutdown.
- A `dedicated` CI job on a Linux runner: it fetches Valve's standalone steamclient anonymously
  (`steamcmd +login anonymous +download_depot 1007 1006`, app 1007 being the Steamworks SDK Redist)
  and runs the mode above on every push, behind the same cookie-gated SDK download and the same
  skip-with-notice semantics. The plain offline matrix gained macOS.
- The dedicated-server accessors now ship in the generated symbol tables. Until now each interface's
  table carried only its client accessor, so `SteamAPI_SteamGameServerHTTP_v003` and its six
  siblings never resolved and every shared interface refused with a `SteamInterfaceError` on any
  machine — the "dev machine answers null" story was that refusal, misread. Codegen now emits every
  accessor an interface has; on a standalone steamclient all seven answer, and the full run's
  development-machine assertion still guards the desktop-client path.

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
