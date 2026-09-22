/**
 * Builds a real binary with `deno compile --include`, runs it, and checks that the
 * embedded Steam library loads.
 *
 * This is the test behind the package's headline claim. Without a Steam client running,
 * `SteamAPI_InitFlat` reports NoSteamClient, which still proves the library was found,
 * opened and called: a missing library fails earlier and differently.
 *
 * Needs STEAMWORKS_SDK_PATH. Skipped without it.
 */
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { libraryFileName, redistributablePath } from "./src/lib.ts";

const sdk = Deno.env.get("STEAMWORKS_SDK_PATH");

Deno.test({
  name: "a compiled binary loads the library included beside it",
  ignore: !sdk,
  async fn() {
    const dir = await Deno.makeTempDir();
    const modUrl = new URL("mod.ts", import.meta.url).href;

    await Deno.copyFile(join(sdk!, redistributablePath()), join(dir, libraryFileName()));
    // The package uses bare specifiers, so the consuming project needs an import map.
    // A project that installs from JSR gets this from the package's own manifest.
    await Deno.writeTextFile(
      join(dir, "deno.json"),
      JSON.stringify({ imports: { "@std/path": "jsr:@std/path@1" } }, null, 2),
    );
    await Deno.writeTextFile(
      join(dir, "main.ts"),
      [
        `import { embeddedLibraryPath, SteamClient, SteamInitError, SteamInitResult } from "${modUrl}";`,
        `try {`,
        `  const steam = SteamClient.init({`,
        `    appId: 480,`,
        `    libraryPath: embeddedLibraryPath(import.meta.url),`,
        `  });`,
        `  console.log("INIT_OK " + steam.utils.getAppID());`,
        `  steam.shutdown();`,
        `} catch (e) {`,
        `  if (e instanceof SteamInitError) console.log("INIT_RESULT " + SteamInitResult[e.result]);`,
        `  else console.log("OTHER " + (e as Error).message);`,
        `}`,
      ].join("\n"),
    );

    const exe = join(dir, Deno.build.os === "windows" ? "game.exe" : "game");
    const build = await new Deno.Command(Deno.execPath(), {
      args: [
        "compile",
        "--config",
        join(dir, "deno.json"),
        "--allow-ffi",
        "--allow-env",
        "--allow-read",
        "--include",
        join(dir, libraryFileName()),
        "--output",
        exe,
        join(dir, "main.ts"),
      ],
      stderr: "piped",
      stdout: "null",
    }).output();
    assertEquals(build.success, true, new TextDecoder().decode(build.stderr));

    const run = await new Deno.Command(exe, { stdout: "piped", stderr: "piped" }).output();
    const out = new TextDecoder().decode(run.stdout).trim();
    const err = new TextDecoder().decode(run.stderr).trim();

    const loaded = out.startsWith("INIT_OK") || out.startsWith("INIT_RESULT");
    assertEquals(loaded, true, `stdout: ${out}\nstderr: ${err}`);
  },
});
