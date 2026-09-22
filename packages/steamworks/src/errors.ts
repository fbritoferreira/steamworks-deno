/** Result codes returned by `SteamAPI_InitFlat`. */
export enum SteamInitResult {
  OK = 0,
  FailedGeneric = 1,
  NoSteamClient = 2,
  VersionMismatch = 3,
}

/** Thrown when the Steam client cannot be initialised. */
export class SteamInitError extends Error {
  constructor(
    readonly result: SteamInitResult,
    readonly steamMessage: string,
    /** Which entry point failed, since a client and a game server use different ones. */
    readonly entryPoint = "SteamAPI_InitFlat",
  ) {
    super(`${entryPoint} failed (${SteamInitResult[result] ?? result}): ${steamMessage}`);
    this.name = "SteamInitError";
  }
}

/** Thrown when Steam has no instance of an interface, usually an SDK version mismatch. */
export class SteamInterfaceError extends Error {
  constructor(
    readonly interfaceName: string,
    readonly accessor: string,
    readonly generatedFor: string,
  ) {
    super(
      `Steam returned no ${interfaceName}: the accessor ${accessor} is missing or returned null. ` +
        `These bindings were generated for SDK ${generatedFor}; check that the library in ` +
        `redistributable_bin matches.`,
    );
    this.name = "SteamInterfaceError";
  }
}
