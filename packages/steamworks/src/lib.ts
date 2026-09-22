import { fromFileUrl } from "@std/path";

/**
 * Symbol table for the subset of the Steamworks flat C API used by this package,
 * plus resolution of the native library path.
 *
 * Accessor names are versioned per SDK release (SDK 1.65: SteamUser v023,
 * SteamFriends v018, SteamUtils v011, SteamUserStats v013, SteamApps v009).
 */

/** The Steamworks SDK release these bindings were generated from. */
export const SDK_VERSION = "1.65";

/** Lifecycle and manual dispatch: the symbols the client needs before any interface. */
export const CORE_SYMBOLS = {
  // --- lifecycle -----------------------------------------------------------
  SteamAPI_InitFlat: { parameters: ["buffer"], result: "i32" },
  SteamAPI_Shutdown: { parameters: [], result: "void" },
  SteamAPI_IsSteamRunning: { parameters: [], result: "bool" },
  SteamAPI_RestartAppIfNecessary: { parameters: ["u32"], result: "bool" },
  SteamAPI_GetHSteamPipe: { parameters: [], result: "i32" },
  SteamAPI_GetHSteamUser: { parameters: [], result: "i32" },
  SteamAPI_ReleaseCurrentThreadMemory: { parameters: [], result: "void" },

  // --- manual dispatch -----------------------------------------------------
  SteamAPI_ManualDispatch_Init: { parameters: [], result: "void" },
  SteamAPI_ManualDispatch_RunFrame: { parameters: ["i32"], result: "void" },
  SteamAPI_ManualDispatch_GetNextCallback: { parameters: ["i32", "buffer"], result: "bool" },
  SteamAPI_ManualDispatch_FreeLastCallback: { parameters: ["i32"], result: "void" },
  SteamAPI_ManualDispatch_GetAPICallResult: {
    parameters: ["i32", "u64", "buffer", "i32", "i32", "buffer"],
    result: "bool",
  },
} as const satisfies Deno.ForeignLibraryInterface;

/** An opened Steam library holding the core symbols. */
export type SteamLib = Deno.DynamicLibrary<typeof CORE_SYMBOLS>;

type DlOpen = <S extends Deno.ForeignLibraryInterface>(
  path: string,
  symbols: S,
) => Deno.DynamicLibrary<S>;

/**
 * One Steam library, opened once per symbol table.
 *
 * The SDK exports over a thousand symbols. Loading them all up front costs startup time and
 * turns one symbol missing from an older SDK into a failure to open anything, so each
 * interface opens only its own table, all against the same file.
 */
export class LibraryHandle {
  #lib: Deno.DynamicLibrary<Deno.ForeignLibraryInterface> | undefined;
  readonly #dlopen: DlOpen;

  constructor(readonly path: string, dlopen: DlOpen = Deno.dlopen) {
    this.#dlopen = dlopen;
  }

  /**
   * Open the library, once.
   *
   * Calling this twice is a bug, and a costly one to find: inside a binary built with
   * `deno compile`, each `Deno.dlopen` of an embedded library extracts a separate copy,
   * so the second instance has never run `SteamAPI_InitFlat` and every interface accessor
   * answers null. Uncompiled, the two share state and the bug stays hidden.
   */
  open<S extends Deno.ForeignLibraryInterface>(symbols: S): Deno.DynamicLibrary<S> {
    if (this.#lib) throw new Error("The Steam library is already open; open it once.");
    const lib = this.#dlopen(this.path, symbols);
    this.#lib = lib as Deno.DynamicLibrary<Deno.ForeignLibraryInterface>;
    return lib;
  }

  get isOpen(): boolean {
    return this.#lib !== undefined;
  }

  closeAll(): void {
    this.#lib?.close();
    this.#lib = undefined;
  }
}

/** Where to find the Steam library. */
export interface ResolveLibraryOptions {
  /** Absolute path to libsteam_api.dylib / libsteam_api.so / steam_api64.dll. Wins over everything. */
  libraryPath?: string;
  /** Root of an unzipped Steamworks SDK (the folder containing `redistributable_bin/`). */
  sdkPath?: string;
  /** Override `Deno.build` for testing. */
  build?: { os: string; arch: string };
  /** Override env lookup for testing. */
  env?: (key: string) => string | undefined;
}

/** Relative path of the redistributable library inside the SDK for a given platform. */
export function redistributablePath(
  build: { os: string; arch: string } = Deno.build,
): string {
  const { os, arch } = build;
  if (os === "darwin") return "redistributable_bin/osx/libsteam_api.dylib";
  if (os === "linux" && arch === "x86_64") return "redistributable_bin/linux64/libsteam_api.so";
  if (os === "linux" && arch === "aarch64") return "redistributable_bin/linuxarm64/libsteam_api.so";
  if (os === "windows" && arch === "x86_64") return "redistributable_bin/win64/steam_api64.dll";
  throw new Error(`Unsupported platform for Steamworks: ${os}/${arch}`);
}

/**
 * Decide where to load the Steam library from. Precedence:
 * 1. `libraryPath` option
 * 2. `sdkPath` option
 * 3. `STEAMWORKS_LIB_PATH` env var
 * 4. `STEAMWORKS_SDK_PATH` env var
 */
export function resolveLibraryPath(opts: ResolveLibraryOptions = {}): string {
  const build = opts.build ?? Deno.build;
  const env = opts.env ?? ((k: string) => Deno.env.get(k));
  if (opts.libraryPath) return opts.libraryPath;
  if (opts.sdkPath) return join(opts.sdkPath, redistributablePath(build));
  const envLib = env("STEAMWORKS_LIB_PATH");
  if (envLib) return envLib;
  const envSdk = env("STEAMWORKS_SDK_PATH");
  if (envSdk) return join(envSdk, redistributablePath(build));
  throw new Error(
    "Cannot locate the Steamworks library. Pass `libraryPath` or `sdkPath` to SteamClient.init, " +
      "or set STEAMWORKS_LIB_PATH / STEAMWORKS_SDK_PATH. Download the SDK from " +
      "https://partner.steamgames.com/downloads/steamworks_sdk.zip",
  );
}

function join(base: string, rel: string): string {
  const sep = base.endsWith("/") || base.endsWith("\\") ? "" : "/";
  return `${base}${sep}${rel}`;
}

/** File name of the Steam library on one platform, as the SDK ships it. */
export function libraryFileName(build: { os: string; arch: string } = Deno.build): string {
  const rel = redistributablePath(build);
  return rel.slice(rel.lastIndexOf("/") + 1);
}

/**
 * Path to a Steam library embedded in a binary built with `deno compile`.
 *
 * `deno compile --include libsteam_api.dylib` unpacks the file next to the module that
 * references it at run time. That module is your entry point, not a file inside this
 * package, so pass your own `import.meta.url`:
 *
 * ```ts
 * SteamClient.init({ appId: 480, libraryPath: embeddedLibraryPath(import.meta.url) });
 * ```
 *
 * The path is built with `fromFileUrl` rather than by joining strings, because a
 * forward-slash path misses the embedded file on Windows (Deno issue 31218).
 */
export function embeddedLibraryPath(
  moduleUrl: string,
  build: { os: string; arch: string } = Deno.build,
): string {
  return fromFileUrl(new URL(libraryFileName(build), moduleUrl));
}
