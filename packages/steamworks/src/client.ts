import {
  openSteamLib,
  type ResolveLibraryOptions,
  resolveLibraryPath,
  type SteamLib,
} from "./lib.ts";
import { readFixedString } from "./cstring.ts";
import { SteamInitError, SteamInitResult } from "./errors.ts";
import { type AnyCallbackListener, type CallbackListener, Dispatcher } from "./dispatch.ts";
import {
  CALLBACK_MSG_SIZE,
  CallbackId,
  type CallbackMsg,
  decodeCallbackMsg,
  decodeSteamAPICallCompleted,
} from "./callbacks.ts";
import { SteamApps, SteamFriends, SteamUser, SteamUserStats, SteamUtils } from "./interfaces.ts";

export interface SteamClientOptions extends ResolveLibraryOptions {
  /** Your Steam AppID. Use 480 (Spacewar) while developing. */
  appId: number;
  /**
   * Call `SteamAPI_RestartAppIfNecessary` before init. When it returns true Steam is
   * relaunching the game through the client and this process should exit; we throw
   * `SteamRestartRequested` in that case. Default false (development).
   */
  restartIfNecessary?: boolean;
}

export class SteamRestartRequested extends Error {
  constructor() {
    super("Steam is relaunching the app through the Steam client; exit now.");
    this.name = "SteamRestartRequested";
  }
}

/**
 * A connected Steam client. Create with {@link SteamClient.init}, call
 * {@link SteamClient.runCallbacks} every frame (or use {@link SteamClient.startPump}),
 * and {@link SteamClient.shutdown} on exit.
 */
export class SteamClient {
  readonly libraryPath: string;
  readonly user: SteamUser;
  readonly friends: SteamFriends;
  readonly utils: SteamUtils;
  readonly apps: SteamApps;
  readonly userStats: SteamUserStats;

  readonly #lib: SteamLib;
  readonly #pipe: number;
  readonly #dispatcher = new Dispatcher();
  readonly #msgBuf = new Uint8Array(CALLBACK_MSG_SIZE);
  #closed = false;

  private constructor(lib: SteamLib, pipe: number, libraryPath: string) {
    this.#lib = lib;
    this.#pipe = pipe;
    this.libraryPath = libraryPath;
    const s = lib.symbols;
    this.user = new SteamUser(s, s.SteamAPI_SteamUser_v023());
    this.friends = new SteamFriends(s, s.SteamAPI_SteamFriends_v018());
    this.utils = new SteamUtils(s, s.SteamAPI_SteamUtils_v011());
    this.apps = new SteamApps(s, s.SteamAPI_SteamApps_v009());
    this.userStats = new SteamUserStats(s, s.SteamAPI_SteamUserStats_v013(), this);
  }

  /**
   * Load the Steam library, initialise the API and switch to manual callback dispatch.
   * Requires the Steam client to be running and logged in.
   */
  static init(opts: SteamClientOptions): SteamClient {
    const path = resolveLibraryPath(opts);
    // Same trick steamworks-rs uses: lets libsteam_api know the AppID without steam_appid.txt.
    Deno.env.set("SteamAppId", String(opts.appId));
    Deno.env.set("SteamGameId", String(opts.appId));

    const lib = openSteamLib(path);
    try {
      if (opts.restartIfNecessary && lib.symbols.SteamAPI_RestartAppIfNecessary(opts.appId)) {
        throw new SteamRestartRequested();
      }
      const errBuf = new Uint8Array(1024);
      const result = lib.symbols.SteamAPI_InitFlat(errBuf) as SteamInitResult;
      if (result !== SteamInitResult.OK) {
        throw new SteamInitError(result, readFixedString(errBuf, 0, errBuf.length));
      }
      lib.symbols.SteamAPI_ManualDispatch_Init();
      const pipe = lib.symbols.SteamAPI_GetHSteamPipe();
      const client = new SteamClient(lib, pipe, path);
      // Steam delivers the user's stats/achievement schema during the first frame.
      // Prime once so `userStats` is usable straight after init.
      client.runCallbacks();
      return client;
    } catch (e) {
      lib.close();
      throw e;
    }
  }

  /** Subscribe to an unsolicited callback by id. Returns an unsubscribe function. */
  on(callbackId: number, listener: CallbackListener): () => void {
    return this.#dispatcher.on(callbackId, listener);
  }

  /** Observe every callback id that comes through the pump. */
  onAny(listener: AnyCallbackListener): () => void {
    return this.#dispatcher.onAny(listener);
  }

  /**
   * Turn a `SteamAPICall_t` handle into a promise for the decoded result struct.
   * Resolves during a later {@link runCallbacks}.
   */
  callResult<T>(handle: bigint, callbackId: number, decode: (bytes: Uint8Array) => T): Promise<T> {
    return this.#dispatcher.waitFor(handle, callbackId).then(decode);
  }

  /**
   * Drain Steam's callback queue once. Call every frame from the main thread.
   * Returns the number of callbacks processed.
   */
  runCallbacks(): number {
    this.#assertOpen();
    const s = this.#lib.symbols;
    s.SteamAPI_ManualDispatch_RunFrame(this.#pipe);
    let processed = 0;
    while (s.SteamAPI_ManualDispatch_GetNextCallback(this.#pipe, this.#msgBuf)) {
      try {
        const msg = decodeCallbackMsg(this.#msgBuf);
        if (msg.callbackId === CallbackId.SteamAPICallCompleted) {
          this.#completeCall(msg);
        } else {
          this.#dispatcher.emit(msg.callbackId, copyParam(msg));
        }
        processed++;
      } finally {
        s.SteamAPI_ManualDispatch_FreeLastCallback(this.#pipe);
      }
    }
    return processed;
  }

  /** Convenience: pump callbacks on an interval. Returns a stop function. */
  startPump(intervalMs = 16): () => void {
    const id = setInterval(() => {
      if (!this.#closed) this.runCallbacks();
    }, intervalMs);
    return () => clearInterval(id);
  }

  get pendingCallResults(): number {
    return this.#dispatcher.pendingCount;
  }

  shutdown(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#dispatcher.rejectAll(new Error("SteamClient shut down"));
    this.#lib.symbols.SteamAPI_Shutdown();
    this.#lib.close();
  }

  #completeCall(msg: CallbackMsg): void {
    const completed = decodeSteamAPICallCompleted(copyParam(msg));
    const pending = this.#dispatcher.takePending(completed.asyncCall);
    if (!pending) return; // nobody awaiting this handle
    const out = new Uint8Array(completed.paramSize);
    const failed = new Uint8Array(1);
    const ok = this.#lib.symbols.SteamAPI_ManualDispatch_GetAPICallResult(
      this.#pipe,
      completed.asyncCall,
      out,
      out.length,
      completed.callbackId,
      failed,
    );
    if (!ok || failed[0] !== 0) {
      pending.reject(new Error(`Steam CallResult ${completed.asyncCall} failed`));
    } else if (completed.callbackId !== pending.callbackId) {
      pending.reject(
        new Error(
          `CallResult callback id mismatch: expected ${pending.callbackId}, got ${completed.callbackId}`,
        ),
      );
    } else {
      pending.resolve(out);
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("SteamClient has been shut down");
  }
}

function copyParam(msg: CallbackMsg): Uint8Array {
  if (msg.paramPtr === null || msg.paramSize === 0) return new Uint8Array(0);
  const view = new Deno.UnsafePointerView(msg.paramPtr);
  return new Uint8Array(view.getArrayBuffer(msg.paramSize).slice(0));
}
