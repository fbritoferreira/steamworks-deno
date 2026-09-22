/**
 * Deno FFI bindings for the Steamworks SDK.
 *
 * Not affiliated with or endorsed by Valve Corporation. "Steam" and
 * "Steamworks" are trademarks of Valve Corporation. This package ships no
 * Valve binaries: you must download the Steamworks SDK yourself and point the
 * library at it (see {@link SteamClient.init}).
 *
 * @module
 */
export { SteamClient, type SteamClientOptions } from "./src/client.ts";
export { type ResolveLibraryOptions, resolveLibraryPath } from "./src/lib.ts";
export { SteamInitError } from "./src/errors.ts";
export * as callbacks from "./src/callbacks.ts";
