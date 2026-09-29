import { type ResolveLibraryOptions, resolveLibraryPath } from "./lib.ts";

/**
 * Whether the desktop Steam client is running, asked of the redistributable library
 * itself: `SteamAPI_IsSteamRunning` needs no initialisation, only the opened library.
 *
 * The live tests run when the SDK is present, but they also need a running, logged-in
 * Steam client — an SDK on its own is not enough. Until this existed, a down Steam
 * client turned six honest skips into six failures, so the tests ask this first and
 * skip when it answers false. Anything that fails to resolve or open counts as no.
 */
export function steamClientRunning(opts: ResolveLibraryOptions = {}): boolean {
  try {
    const lib = Deno.dlopen(resolveLibraryPath(opts), {
      SteamAPI_IsSteamRunning: { parameters: [], result: "bool" },
    });
    try {
      return lib.symbols.SteamAPI_IsSteamRunning();
    } finally {
      lib.close();
    }
  } catch {
    return false;
  }
}
