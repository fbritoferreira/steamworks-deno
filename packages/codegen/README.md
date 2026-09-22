# @steamworks/codegen

Generates [`@steamworks/deno`](https://jsr.io/@steamworks/deno) from Valve's `steam_api.json`. Use
it to regenerate the bindings against a different Steamworks SDK release than the one they ship for.

> **Not affiliated with Valve.** "Steam" and "Steamworks" are trademarks of Valve Corporation. This
> package contains no Valve code or binaries: you download the SDK yourself.

## What it produces

From one SDK it writes a complete binding set:

- a Deno FFI symbol table and a typed wrapper class for each of the 34 interfaces
- a decoder for every struct, with field offsets for both struct packings
- every enumeration and constant, with C expressions such as `128 + 1` evaluated
- a C++ program that prints the real layouts, so a test can check them against a compiler

## Usage

```ts
import { generate } from "@steamworks/codegen";

const written = await generate({
  sdkPath: "/path/to/steamworks_sdk", // the folder holding public/ and redistributable_bin/
  outDir: "./gen",
});

console.log(`wrote ${written.length} files`);
```

Run it with `--allow-read --allow-write --allow-run --allow-env`. The run step is `deno fmt`, which
formats the output.

You can also read the schema without generating anything:

```ts
import { loadSchema } from "@steamworks/codegen";

const schema = await loadSchema("/path/to/sdk/public/steam/steam_api.json");
console.log(schema.interfaces.length); // 34
console.log(schema.callback_structs.length); // 196
```

## Why struct packing is read from the headers

`steam_api.json` says nothing about packing, and the headers use three regimes. Most callback
structs sit in a region that is 4 bytes on macOS and Linux and 8 on Windows. The Steam Input structs
sit in a fixed `pack(1)` block. `SteamNetworkingMessage_t` sits outside any region and uses natural
alignment.

Assuming one packing per platform gets five structs wrong, so the generator scans the pragma regions
instead. A generated C++ harness checks the result against a real compiler.

## Documentation

`steam_api.json` documents nothing: zero descriptions across its 921 methods. The headers document
about 63 percent of them, so the generator harvests those comments into JSDoc.

## Licence

MIT. The Steamworks SDK is licensed separately by Valve under the
[Steamworks SDK Access Agreement](https://partner.steamgames.com/documentation/sdk_access_agreement).
