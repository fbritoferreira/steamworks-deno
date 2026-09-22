import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  embeddedLibraryPath,
  libraryFileName,
  LibraryHandle,
  redistributablePath,
  resolveLibraryPath,
} from "./lib.ts";

const mac = { os: "darwin", arch: "aarch64" };
const noEnv = () => undefined;

Deno.test("redistributablePath maps platforms", () => {
  assertEquals(redistributablePath(mac), "redistributable_bin/osx/libsteam_api.dylib");
  assertEquals(
    redistributablePath({ os: "linux", arch: "x86_64" }),
    "redistributable_bin/linux64/libsteam_api.so",
  );
  assertEquals(
    redistributablePath({ os: "windows", arch: "x86_64" }),
    "redistributable_bin/win64/steam_api64.dll",
  );
  assertThrows(() => redistributablePath({ os: "freebsd", arch: "x86_64" }));
});

Deno.test("resolveLibraryPath: explicit libraryPath wins", () => {
  assertEquals(
    resolveLibraryPath({ libraryPath: "/x/lib.dylib", sdkPath: "/sdk", build: mac, env: noEnv }),
    "/x/lib.dylib",
  );
});

Deno.test("resolveLibraryPath: sdkPath appends platform path", () => {
  assertEquals(
    resolveLibraryPath({ sdkPath: "/sdk/", build: mac, env: noEnv }),
    "/sdk/redistributable_bin/osx/libsteam_api.dylib",
  );
});

Deno.test("resolveLibraryPath: env fallbacks in order", () => {
  const env = (k: string) => ({ STEAMWORKS_SDK_PATH: "/env-sdk" } as Record<string, string>)[k];
  assertEquals(
    resolveLibraryPath({ build: mac, env }),
    "/env-sdk/redistributable_bin/osx/libsteam_api.dylib",
  );
  const env2 = (k: string) =>
    ({ STEAMWORKS_LIB_PATH: "/direct.so", STEAMWORKS_SDK_PATH: "/env-sdk" } as Record<
      string,
      string
    >)[k];
  assertEquals(resolveLibraryPath({ build: mac, env: env2 }), "/direct.so");
});

Deno.test("resolveLibraryPath: throws with download hint when nothing set", () => {
  assertThrows(() => resolveLibraryPath({ build: mac, env: noEnv }), Error, "steamworks_sdk.zip");
});

Deno.test("LibraryHandle opens the library once and refuses a second open", () => {
  const calls: string[] = [];
  const fake = <S extends Deno.ForeignLibraryInterface>(path: string, symbols: S) => {
    calls.push(`open ${path}:${Object.keys(symbols).length}`);
    return { symbols: {}, close: () => calls.push("close") } as unknown as Deno.DynamicLibrary<S>;
  };
  const handle = new LibraryHandle("/lib.dylib", fake);
  const table = { SteamAPI_Foo: { parameters: [], result: "void" } } as const;
  handle.open(table);
  assertEquals(handle.isOpen, true);
  // A second open would hand back an uninitialised instance inside a compiled binary.
  assertThrows(() => handle.open(table), Error, "already open");
  handle.closeAll();
  assertEquals(calls, ["open /lib.dylib:1", "close"]);
  assertEquals(handle.isOpen, false);
});

Deno.test("libraryFileName covers every platform Deno targets", () => {
  assertEquals(libraryFileName({ os: "darwin", arch: "aarch64" }), "libsteam_api.dylib");
  assertEquals(libraryFileName({ os: "linux", arch: "x86_64" }), "libsteam_api.so");
  assertEquals(libraryFileName({ os: "linux", arch: "aarch64" }), "libsteam_api.so");
  assertEquals(libraryFileName({ os: "windows", arch: "x86_64" }), "steam_api64.dll");
});

Deno.test("embeddedLibraryPath resolves beside the caller's module", () => {
  const path = embeddedLibraryPath("file:///app/main.ts", { os: "linux", arch: "x86_64" });
  // fromFileUrl follows the host, so compare with separators normalised.
  assertEquals(path.replaceAll("\\", "/"), "/app/libsteam_api.so");
});

Deno.test("embeddedLibraryPath handles a Windows module URL", () => {
  const path = embeddedLibraryPath("file:///D:/app/main.ts", { os: "windows", arch: "x86_64" });
  assertEquals(path.endsWith("steam_api64.dll"), true);
  // fromFileUrl follows the host, so only a Windows host drops the slash before the
  // drive letter. That is the platform where it matters: a compiled binary looks the
  // file up by this exact string.
  if (Deno.build.os === "windows") assertEquals(path.startsWith("/"), false);
});

Deno.test("embeddedLibraryPath keeps the caller's directory", () => {
  const path = embeddedLibraryPath("file:///games/mygame/main.ts", {
    os: "darwin",
    arch: "aarch64",
  });
  assertEquals(path.replaceAll("\\", "/"), "/games/mygame/libsteam_api.dylib");
});
