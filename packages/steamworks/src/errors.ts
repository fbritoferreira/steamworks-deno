/** Result codes returned by `SteamAPI_InitFlat`. */
export enum SteamInitResult {
  OK = 0,
  FailedGeneric = 1,
  NoSteamClient = 2,
  VersionMismatch = 3,
}

/** Thrown when the Steam client cannot be initialised. */
export class SteamInitError extends Error {
  constructor(readonly result: SteamInitResult, readonly steamMessage: string) {
    super(`SteamAPI_InitFlat failed (${SteamInitResult[result] ?? result}): ${steamMessage}`);
    this.name = "SteamInitError";
  }
}
