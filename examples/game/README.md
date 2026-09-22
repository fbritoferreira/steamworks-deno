# Pong, with Steam

A one-screen game that talks to Steam while it runs. Two native libraries share the process: raylib
draws, and `libsteam_api` talks to the Steam client.

It exists to exercise the two things this package claims and a script cannot show:

- Steam's callbacks pumped from the same loop that draws, once per frame, the way a game does it
  rather than on a timer
- two FFI libraries coexisting in one process, and in one binary built with `deno compile`

Score a point and it unlocks `ACH_WIN_ONE_GAME` on Valve's Spacewar test app. The confirmation
arrives as a callback a frame or two later and appears on the panel. The achievement is cleared
again on exit so the demo can be run repeatedly.

## Running it

Needs raylib, the Steamworks SDK, and the Steam client running and logged in.

```sh
brew install raylib                      # or apt install libraylib-dev
export STEAMWORKS_SDK_PATH=/path/to/sdk
deno task game
```

W and S, or the arrow keys, move the paddle. Escape quits.

## Building a standalone binary

Put both libraries **beside `main.ts`**, then include them:

```sh
cp "$STEAMWORKS_SDK_PATH/redistributable_bin/osx/libsteam_api.dylib" examples/game/
cp /opt/homebrew/lib/libraylib.dylib examples/game/

deno compile --allow-ffi --allow-env --allow-read \
  --include examples/game/libsteam_api.dylib \
  --include examples/game/libraylib.dylib \
  --output pong examples/game/main.ts
```

The result runs with no SDK, no raylib installed and no environment variables set.

### Two things that cost me an afternoon

**An included file keeps its original path.** `deno compile` mirrors the path the file had when you
included it, so a library included from a temporary directory does not land beside your module and
`import.meta.url` will not find it. Copy it next to the module first.

**An embedded library can be opened but not inspected.** It lives in the binary's virtual file
system, so `Deno.statSync` reports it missing while `Deno.dlopen` loads it happily. Code that checks
the file exists before opening it rejects exactly the case that matters. Try the open and catch the
failure instead.
