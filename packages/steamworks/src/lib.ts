/**
 * Symbol table for the subset of the Steamworks flat C API used by this package,
 * plus resolution of the native library path.
 *
 * Accessor names are versioned per SDK release (SDK 1.65: SteamUser v023,
 * SteamFriends v018, SteamUtils v011, SteamUserStats v013, SteamApps v009).
 */

export const SDK_VERSION = "1.65";

export const SYMBOLS = {
  // --- lifecycle -----------------------------------------------------------
  SteamAPI_InitFlat: { parameters: ["buffer"], result: "i32" },
  SteamAPI_Shutdown: { parameters: [], result: "void" },
  SteamAPI_IsSteamRunning: { parameters: [], result: "bool" },
  SteamAPI_RestartAppIfNecessary: { parameters: ["u32"], result: "bool" },
  SteamAPI_GetHSteamPipe: { parameters: [], result: "i32" },
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

  // --- interface accessors -------------------------------------------------
  SteamAPI_SteamUser_v023: { parameters: [], result: "pointer" },
  SteamAPI_SteamFriends_v018: { parameters: [], result: "pointer" },
  SteamAPI_SteamUtils_v011: { parameters: [], result: "pointer" },
  SteamAPI_SteamUserStats_v013: { parameters: [], result: "pointer" },
  SteamAPI_SteamApps_v009: { parameters: [], result: "pointer" },

  // --- ISteamUser ----------------------------------------------------------
  SteamAPI_ISteamUser_GetSteamID: { parameters: ["pointer"], result: "u64" },

  // --- ISteamFriends -------------------------------------------------------
  SteamAPI_ISteamFriends_GetPersonaName: { parameters: ["pointer"], result: "pointer" },
  SteamAPI_ISteamFriends_GetPersonaState: { parameters: ["pointer"], result: "i32" },
  SteamAPI_ISteamFriends_ActivateGameOverlay: { parameters: ["pointer", "buffer"], result: "void" },

  // --- ISteamUtils ---------------------------------------------------------
  SteamAPI_ISteamUtils_GetAppID: { parameters: ["pointer"], result: "u32" },
  SteamAPI_ISteamUtils_IsOverlayEnabled: { parameters: ["pointer"], result: "bool" },
  SteamAPI_ISteamUtils_GetIPCountry: { parameters: ["pointer"], result: "pointer" },
  SteamAPI_ISteamUtils_GetSteamUILanguage: { parameters: ["pointer"], result: "pointer" },

  // --- ISteamApps ----------------------------------------------------------
  SteamAPI_ISteamApps_GetAppBuildId: { parameters: ["pointer"], result: "i32" },
  SteamAPI_ISteamApps_BIsSubscribed: { parameters: ["pointer"], result: "bool" },
  SteamAPI_ISteamApps_GetCurrentGameLanguage: { parameters: ["pointer"], result: "pointer" },

  // --- ISteamUserStats -----------------------------------------------------
  SteamAPI_ISteamUserStats_GetNumAchievements: { parameters: ["pointer"], result: "u32" },
  SteamAPI_ISteamUserStats_GetAchievementName: {
    parameters: ["pointer", "u32"],
    result: "pointer",
  },
  SteamAPI_ISteamUserStats_GetAchievement: {
    parameters: ["pointer", "buffer", "buffer"],
    result: "bool",
  },
  SteamAPI_ISteamUserStats_SetAchievement: { parameters: ["pointer", "buffer"], result: "bool" },
  SteamAPI_ISteamUserStats_ClearAchievement: { parameters: ["pointer", "buffer"], result: "bool" },
  SteamAPI_ISteamUserStats_StoreStats: { parameters: ["pointer"], result: "bool" },
  SteamAPI_ISteamUserStats_GetAchievementDisplayAttribute: {
    parameters: ["pointer", "buffer", "buffer"],
    result: "pointer",
  },
  SteamAPI_ISteamUserStats_RequestGlobalAchievementPercentages: {
    parameters: ["pointer"],
    result: "u64",
  },
  SteamAPI_ISteamUserStats_GetAchievementAchievedPercent: {
    parameters: ["pointer", "buffer", "buffer"],
    result: "bool",
  },
  SteamAPI_ISteamUserStats_GetStatInt32: {
    parameters: ["pointer", "buffer", "buffer"],
    result: "bool",
  },
  SteamAPI_ISteamUserStats_SetStatInt32: {
    parameters: ["pointer", "buffer", "i32"],
    result: "bool",
  },
} as const satisfies Deno.ForeignLibraryInterface;

export type SteamLib = Deno.DynamicLibrary<typeof SYMBOLS>;

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
export function redistributablePath(build: { os: string; arch: string }): string {
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

export function openSteamLib(path: string): SteamLib {
  return Deno.dlopen(path, SYMBOLS);
}
