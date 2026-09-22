import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { LibraryHandle, redistributablePath, resolveLibraryPath } from "./lib.ts";

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

Deno.test("LibraryHandle opens each symbol table once and closes them all", () => {
  const calls: string[] = [];
  const fake = <S extends Deno.ForeignLibraryInterface>(path: string, symbols: S) => {
    calls.push(`open ${path}:${Object.keys(symbols).join(",")}`);
    return {
      symbols: {},
      close: () => calls.push("close"),
    } as unknown as Deno.DynamicLibrary<S>;
  };
  const handle = new LibraryHandle("/lib.dylib", fake);
  const a = { SteamAPI_Foo: { parameters: [], result: "void" } } as const;
  const b = { SteamAPI_Bar: { parameters: [], result: "void" } } as const;
  handle.open(a);
  handle.open(a);
  handle.open(b);
  assertEquals(calls, ["open /lib.dylib:SteamAPI_Foo", "open /lib.dylib:SteamAPI_Bar"]);
  handle.closeAll();
  assertEquals(calls.filter((c) => c === "close").length, 2);
});
