import type { ParamRole } from "./params.ts";

/**
 * Roles that `steam_api.json` does not express and the naming heuristic gets wrong.
 * Keyed by `methodname_flat`, then by parameter name. Every entry states what is missing
 * and is covered by a case in `params_test.ts`.
 */
export const OVERRIDES: Record<string, Record<string, ParamRole>> = {
  // The JSON gives pchName no out_string_count. The cch heuristic already catches it;
  // this entry pins the behaviour so a heuristic change cannot silently alter it.
  SteamAPI_ISteamApps_GetCurrentBetaName: {
    pchName: { role: "out-string", countParam: "cchNameBufferSize", defaultSize: 256 },
  },
};
