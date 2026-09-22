/**
 * Regenerate the bindings in `packages/steamworks/gen` from a local Steamworks SDK.
 *
 *   STEAMWORKS_SDK_PATH=/path/to/sdk deno task gen
 */
import { generate } from "./src/generate.ts";
import { fromFileUrl } from "@std/path";

const sdkPath = Deno.env.get("STEAMWORKS_SDK_PATH");
if (!sdkPath) {
  console.error(
    "Set STEAMWORKS_SDK_PATH to an unzipped Steamworks SDK (the folder holding public/ and\n" +
      "redistributable_bin/). Download it from\n" +
      "https://partner.steamgames.com/downloads/steamworks_sdk.zip",
  );
  Deno.exit(2);
}

const outDir = Deno.args[0] ?? fromFileUrl(new URL("../steamworks/gen", import.meta.url));
const written = await generate({
  sdkPath,
  outDir,
  sdkVersion: Deno.env.get("STEAMWORKS_SDK_VERSION"),
});
console.log(`wrote ${written.length} files to ${outDir}`);
