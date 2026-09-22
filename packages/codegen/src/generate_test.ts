import { assertEquals, assertRejects } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { generate } from "./generate.ts";

const FIXTURE = fromFileUrl(new URL("../fixtures/steam_api.mini.json", import.meta.url));

/** Lay out a temporary directory shaped like an unzipped SDK. */
async function fakeSdk(readme: string | null): Promise<string> {
  const sdk = await Deno.makeTempDir();
  await Deno.mkdir(`${sdk}/public/steam`, { recursive: true });
  await Deno.copyFile(FIXTURE, `${sdk}/public/steam/steam_api.json`);
  if (readme !== null) await Deno.writeTextFile(`${sdk}/Readme.txt`, readme);
  return sdk;
}

Deno.test("the version comes from the SDK's Readme", async () => {
  const sdk = await fakeSdk("Steamworks SDK v1.65\n");
  const out = await Deno.makeTempDir();
  await generate({ sdkPath: sdk, outDir: `${out}/gen` });
  const mod = await Deno.readTextFile(`${out}/gen/mod.ts`);
  assertEquals(mod.includes('export const SDK_VERSION = "1.65";'), true);
});

Deno.test("an explicit version wins over the Readme", async () => {
  const sdk = await fakeSdk("Steamworks SDK v1.65\n");
  const out = await Deno.makeTempDir();
  await generate({ sdkPath: sdk, outDir: `${out}/gen`, sdkVersion: "1.99" });
  const mod = await Deno.readTextFile(`${out}/gen/mod.ts`);
  assertEquals(mod.includes('export const SDK_VERSION = "1.99";'), true);
});

Deno.test("a missing Readme is refused rather than guessed", async () => {
  const sdk = await fakeSdk(null);
  const out = await Deno.makeTempDir();
  await assertRejects(
    () => generate({ sdkPath: sdk, outDir: `${out}/gen` }),
    Error,
    "Cannot determine the SDK version",
  );
});

Deno.test("a Readme with no version string is refused", async () => {
  const sdk = await fakeSdk("no version here\n");
  const out = await Deno.makeTempDir();
  await assertRejects(
    () => generate({ sdkPath: sdk, outDir: `${out}/gen` }),
    Error,
    "Cannot determine the SDK version",
  );
});

Deno.test("generate writes the expected set of files", async () => {
  const sdk = await fakeSdk("Steamworks SDK v1.65\n");
  const out = await Deno.makeTempDir();
  const written = await generate({ sdkPath: sdk, outDir: `${out}/gen` });
  const names = written.map((p) => p.slice(out.length + 1).replaceAll("\\", "/")).sort();
  assertEquals(names.includes("gen/mod.ts"), true);
  assertEquals(names.includes("gen/structs.ts"), true);
  assertEquals(names.includes("gen/layout.json"), true);
  assertEquals(names.includes("gen/layout_check.cpp"), true);
  assertEquals(names.filter((n) => n.startsWith("gen/interfaces/")).length, 5);
});
