/**
 * Deno FFI bindings for the Steamworks SDK.
 *
 * Not affiliated with or endorsed by Valve Corporation. "Steam" and "Steamworks" are
 * trademarks of Valve Corporation. This package contains no Valve code or binaries: you
 * download the SDK yourself and point {@link SteamClient.init} at it.
 *
 * ```ts
 * import { CallbackId, decodeUserAchievementStored_t, SteamClient } from "@steamworks/deno";
 *
 * const steam = SteamClient.init({ appId: 480 });
 * const stop = steam.startPump();
 * steam.on(CallbackId.UserAchievementStored, (bytes) => {
 *   console.log(decodeUserAchievementStored_t(bytes).m_rgchAchievementName);
 * });
 * steam.userStats.setAchievement("ACH_WIN_ONE_GAME");
 * steam.userStats.storeStats();
 * ```
 *
 * @module
 */
export { SteamClient, type SteamClientOptions, SteamRestartRequested } from "./src/client.ts";
export {
  LibraryHandle,
  redistributablePath,
  type ResolveLibraryOptions,
  resolveLibraryPath,
} from "./src/lib.ts";
export { SteamInitError, SteamInitResult, SteamInterfaceError } from "./src/errors.ts";
export type { AnyCallbackListener, CallbackListener } from "./src/dispatch.ts";
export type { CallResultHost } from "./src/marshal.ts";
export * from "./gen/mod.ts";
