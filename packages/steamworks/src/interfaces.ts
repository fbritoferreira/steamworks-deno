/** Thin typed facades over the flat C API. One class per ISteam* interface. */
import type { SteamLib } from "./lib.ts";
import { cstr, readCString } from "./cstring.ts";
import { CallbackId, decodeGlobalAchievementPercentagesReady } from "./callbacks.ts";
import type { GlobalAchievementPercentagesReady } from "./callbacks.ts";

type Symbols = SteamLib["symbols"];

abstract class Interface {
  protected readonly s: Symbols;
  protected readonly self: Deno.PointerValue;
  constructor(s: Symbols, self: Deno.PointerValue, name: string) {
    if (self === null) throw new Error(`Steam returned a null ${name} interface pointer`);
    this.s = s;
    this.self = self;
  }
}

export class SteamUser extends Interface {
  constructor(s: Symbols, self: Deno.PointerValue) {
    super(s, self, "ISteamUser");
  }
  /** 64-bit SteamID of the logged-in user. */
  steamId(): bigint {
    return this.s.SteamAPI_ISteamUser_GetSteamID(this.self);
  }
}

export class SteamFriends extends Interface {
  constructor(s: Symbols, self: Deno.PointerValue) {
    super(s, self, "ISteamFriends");
  }
  personaName(): string {
    return readCString(this.s.SteamAPI_ISteamFriends_GetPersonaName(this.self));
  }
  personaState(): number {
    return this.s.SteamAPI_ISteamFriends_GetPersonaState(this.self);
  }
  /** dialog: "friends" | "community" | "players" | "settings" | "officialgamegroup" | "stats" | "achievements" */
  activateGameOverlay(dialog: string): void {
    this.s.SteamAPI_ISteamFriends_ActivateGameOverlay(this.self, cstr(dialog));
  }
}

export class SteamUtils extends Interface {
  constructor(s: Symbols, self: Deno.PointerValue) {
    super(s, self, "ISteamUtils");
  }
  appId(): number {
    return this.s.SteamAPI_ISteamUtils_GetAppID(this.self);
  }
  overlayEnabled(): boolean {
    return this.s.SteamAPI_ISteamUtils_IsOverlayEnabled(this.self);
  }
  ipCountry(): string {
    return readCString(this.s.SteamAPI_ISteamUtils_GetIPCountry(this.self));
  }
  uiLanguage(): string {
    return readCString(this.s.SteamAPI_ISteamUtils_GetSteamUILanguage(this.self));
  }
}

export class SteamApps extends Interface {
  constructor(s: Symbols, self: Deno.PointerValue) {
    super(s, self, "ISteamApps");
  }
  buildId(): number {
    return this.s.SteamAPI_ISteamApps_GetAppBuildId(this.self);
  }
  isSubscribed(): boolean {
    return this.s.SteamAPI_ISteamApps_BIsSubscribed(this.self);
  }
  currentGameLanguage(): string {
    return readCString(this.s.SteamAPI_ISteamApps_GetCurrentGameLanguage(this.self));
  }
}

/** Minimal surface needed by interfaces that return CallResults. */
export interface CallResultHost {
  callResult<T>(handle: bigint, callbackId: number, decode: (bytes: Uint8Array) => T): Promise<T>;
}

export interface AchievementInfo {
  apiName: string;
  displayName: string;
  description: string;
  hidden: boolean;
  achieved: boolean;
}

export class SteamUserStats extends Interface {
  readonly #host: CallResultHost;
  constructor(s: Symbols, self: Deno.PointerValue, host: CallResultHost) {
    super(s, self, "ISteamUserStats");
    this.#host = host;
  }

  numAchievements(): number {
    return this.s.SteamAPI_ISteamUserStats_GetNumAchievements(this.self);
  }

  achievementName(index: number): string {
    return readCString(this.s.SteamAPI_ISteamUserStats_GetAchievementName(this.self, index));
  }

  /** `null` when the achievement name is unknown to Steam. */
  isAchieved(apiName: string): boolean | null {
    const out = new Uint8Array(1);
    const ok = this.s.SteamAPI_ISteamUserStats_GetAchievement(this.self, cstr(apiName), out);
    return ok ? out[0] !== 0 : null;
  }

  /** Unlocks locally; call {@link storeStats} to persist and trigger the overlay toast. */
  setAchievement(apiName: string): boolean {
    return this.s.SteamAPI_ISteamUserStats_SetAchievement(this.self, cstr(apiName));
  }

  clearAchievement(apiName: string): boolean {
    return this.s.SteamAPI_ISteamUserStats_ClearAchievement(this.self, cstr(apiName));
  }

  /** Triggers `UserStatsStored_t` and, per changed achievement, `UserAchievementStored_t`. */
  storeStats(): boolean {
    return this.s.SteamAPI_ISteamUserStats_StoreStats(this.self);
  }

  /** key: "name" | "desc" | "hidden" */
  displayAttribute(apiName: string, key: "name" | "desc" | "hidden"): string {
    return readCString(
      this.s.SteamAPI_ISteamUserStats_GetAchievementDisplayAttribute(
        this.self,
        cstr(apiName),
        cstr(key),
      ),
    );
  }

  listAchievements(): AchievementInfo[] {
    const n = this.numAchievements();
    const out: AchievementInfo[] = [];
    for (let i = 0; i < n; i++) {
      const apiName = this.achievementName(i);
      out.push({
        apiName,
        displayName: this.displayAttribute(apiName, "name"),
        description: this.displayAttribute(apiName, "desc"),
        hidden: this.displayAttribute(apiName, "hidden") === "1",
        achieved: this.isAchieved(apiName) ?? false,
      });
    }
    return out;
  }

  /** CallResult example: fetch global unlock percentages, then read them with {@link achievedPercent}. */
  requestGlobalAchievementPercentages(): Promise<GlobalAchievementPercentagesReady> {
    const handle = this.s.SteamAPI_ISteamUserStats_RequestGlobalAchievementPercentages(this.self);
    return this.#host.callResult(
      handle,
      CallbackId.GlobalAchievementPercentagesReady,
      decodeGlobalAchievementPercentagesReady,
    );
  }

  achievedPercent(apiName: string): number | null {
    const out = new Float32Array(1);
    const ok = this.s.SteamAPI_ISteamUserStats_GetAchievementAchievedPercent(
      this.self,
      cstr(apiName),
      new Uint8Array(out.buffer),
    );
    return ok ? out[0] : null;
  }

  getStatInt(name: string): number | null {
    const out = new Int32Array(1);
    const ok = this.s.SteamAPI_ISteamUserStats_GetStatInt32(
      this.self,
      cstr(name),
      new Uint8Array(out.buffer),
    );
    return ok ? out[0] : null;
  }

  setStatInt(name: string, value: number): boolean {
    return this.s.SteamAPI_ISteamUserStats_SetStatInt32(this.self, cstr(name), value);
  }
}
