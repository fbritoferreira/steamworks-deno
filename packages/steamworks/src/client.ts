import {
  CORE_SYMBOLS,
  LibraryHandle,
  type ResolveLibraryOptions,
  resolveLibraryPath,
} from "./lib.ts";
import { readFixedString } from "./cstring.ts";
import { SteamInitError, SteamInitResult, SteamInterfaceError } from "./errors.ts";
import { type AnyCallbackListener, type CallbackListener, Dispatcher } from "./dispatch.ts";
import { PACK } from "./layout.ts";
import {
  CallbackMsg_t_layout,
  decodeCallbackMsg_t,
  decodeSteamAPICallCompleted_t,
} from "../gen/structs.ts";
import { CallbackId } from "../gen/callback_ids.ts";
import * as G from "../gen/mod.ts";

export interface SteamClientOptions extends ResolveLibraryOptions {
  /** Your Steam AppID. Use 480, Valve's Spacewar test app, while developing. */
  appId: number;
  /**
   * Ask Steam whether the game should be relaunched through the client first. When it says
   * yes this throws {@link SteamRestartRequested} and the process should exit.
   */
  restartIfNecessary?: boolean;
}

/** Steam is relaunching the app through the client; this process should exit. */
export class SteamRestartRequested extends Error {
  constructor() {
    super("Steam is relaunching this app through the Steam client; exit now.");
    this.name = "SteamRestartRequested";
  }
}

type Core = Deno.DynamicLibrary<typeof CORE_SYMBOLS>["symbols"];

/**
 * A connected Steam client.
 *
 * Create one with {@link SteamClient.init}, call {@link SteamClient.runCallbacks} once per
 * frame, and {@link SteamClient.shutdown} on exit. Each interface is opened the first time
 * you reach for it.
 */
export class SteamClient {
  readonly libraryPath: string;

  readonly #handle: LibraryHandle;
  readonly #core: Core;
  readonly #pipe: number;
  readonly #dispatcher = new Dispatcher();
  readonly #msgBuf = new Uint8Array(CallbackMsg_t_layout[PACK].size);
  readonly #interfaces = new Map<string, unknown>();
  #closed = false;

  private constructor(handle: LibraryHandle, core: Core, pipe: number) {
    this.#handle = handle;
    this.#core = core;
    this.#pipe = pipe;
    this.libraryPath = handle.path;
  }

  /**
   * Load the Steam library, start the API and switch to manual callback dispatch.
   * The Steam client must be running and logged in.
   */
  static init(opts: SteamClientOptions): SteamClient {
    const handle = new LibraryHandle(resolveLibraryPath(opts));
    // Tells libsteam_api which app this is without a steam_appid.txt beside the binary.
    Deno.env.set("SteamAppId", String(opts.appId));
    Deno.env.set("SteamGameId", String(opts.appId));

    const core = handle.open(CORE_SYMBOLS).symbols;
    try {
      if (opts.restartIfNecessary && core.SteamAPI_RestartAppIfNecessary(opts.appId)) {
        throw new SteamRestartRequested();
      }
      const errBuf = new Uint8Array(1024);
      const result = core.SteamAPI_InitFlat(errBuf) as SteamInitResult;
      if (result !== SteamInitResult.OK) {
        throw new SteamInitError(result, readFixedString(errBuf, 0, errBuf.length));
      }
      core.SteamAPI_ManualDispatch_Init();
      const client = new SteamClient(handle, core, core.SteamAPI_GetHSteamPipe());
      // Steam delivers the user's stats and achievement schema during the first frame,
      // so pump one before handing the client back.
      client.runCallbacks();
      return client;
    } catch (e) {
      handle.closeAll();
      throw e;
    }
  }

  /** Subscribe to one callback id. Returns a function that unsubscribes. */
  on(callbackId: number, listener: CallbackListener): () => void {
    return this.#dispatcher.on(callbackId, listener);
  }

  /** Observe every callback that arrives, whatever its id. */
  onAny(listener: AnyCallbackListener): () => void {
    return this.#dispatcher.onAny(listener);
  }

  /**
   * Turn a `SteamAPICall_t` handle into a promise for its decoded result. Generated wrappers
   * call this; the promise settles during a later {@link runCallbacks}.
   */
  callResult<T>(handle: bigint, callbackId: number, decode: (bytes: Uint8Array) => T): Promise<T> {
    return this.#dispatcher.waitFor(handle, callbackId).then(decode);
  }

  /**
   * Drain Steam's callback queue once, on the calling thread. Call it every frame.
   * Returns how many callbacks were processed.
   */
  runCallbacks(): number {
    if (this.#closed) throw new Error("SteamClient has been shut down");
    const s = this.#core;
    s.SteamAPI_ManualDispatch_RunFrame(this.#pipe);
    let processed = 0;
    while (s.SteamAPI_ManualDispatch_GetNextCallback(this.#pipe, this.#msgBuf)) {
      try {
        const msg = decodeCallbackMsg_t(this.#msgBuf);
        const param = copyParam(msg.m_pubParam, msg.m_cubParam);
        if (msg.m_iCallback === CallbackId.SteamAPICallCompleted) {
          this.#completeCall(param);
        } else {
          this.#dispatcher.emit(msg.m_iCallback, param);
        }
        processed++;
      } finally {
        s.SteamAPI_ManualDispatch_FreeLastCallback(this.#pipe);
      }
    }
    return processed;
  }

  /** Pump callbacks on a timer, for scripts with no game loop. Returns a stop function. */
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
    this.#core.SteamAPI_Shutdown();
    this.#handle.closeAll();
  }

  #completeCall(param: Uint8Array): void {
    const completed = decodeSteamAPICallCompleted_t(param);
    const pending = this.#dispatcher.takePending(completed.m_hAsyncCall);
    if (!pending) return; // nobody is waiting on this handle
    const out = new Uint8Array(completed.m_cubParam);
    const failed = new Uint8Array(1);
    const ok = this.#core.SteamAPI_ManualDispatch_GetAPICallResult(
      this.#pipe,
      completed.m_hAsyncCall,
      out,
      out.length,
      completed.m_iCallback,
      failed,
    );
    if (!ok || failed[0] !== 0) {
      pending.reject(new Error(`Steam call ${completed.m_hAsyncCall} failed`));
    } else if (completed.m_iCallback !== pending.callbackId) {
      pending.reject(
        new Error(
          `Call result id mismatch: expected ${pending.callbackId}, got ${completed.m_iCallback}`,
        ),
      );
    } else {
      pending.resolve(out);
    }
  }

  /** Open one interface's symbol table and wrap its pointer, once. */
  #iface<S extends Deno.ForeignLibraryInterface, T>(
    name: string,
    symbols: S,
    accessor: string,
    make: (s: Deno.DynamicLibrary<S>["symbols"], self: Deno.PointerValue, host: SteamClient) => T,
  ): T {
    const hit = this.#interfaces.get(name);
    if (hit) return hit as T;
    const s = this.#handle.open(symbols).symbols;
    const get = (s as Record<string, unknown>)[accessor] as (() => Deno.PointerValue) | null;
    const self = get?.() ?? null;
    if (self === null) throw new SteamInterfaceError(name, accessor, G.SDK_VERSION);
    const made = make(s, self, this);
    this.#interfaces.set(name, made);
    return made;
  }

  get user(): G.ISteamUser {
    return this.#iface(
      "ISteamUser",
      G.ISteamUser_symbols,
      G.ISteamUser.accessor,
      (s, p, h) => new G.ISteamUser(s, p, h),
    );
  }

  get friends(): G.ISteamFriends {
    return this.#iface(
      "ISteamFriends",
      G.ISteamFriends_symbols,
      G.ISteamFriends.accessor,
      (s, p, h) => new G.ISteamFriends(s, p, h),
    );
  }

  get utils(): G.ISteamUtils {
    return this.#iface(
      "ISteamUtils",
      G.ISteamUtils_symbols,
      G.ISteamUtils.accessor,
      (s, p, h) => new G.ISteamUtils(s, p, h),
    );
  }

  get apps(): G.ISteamApps {
    return this.#iface(
      "ISteamApps",
      G.ISteamApps_symbols,
      G.ISteamApps.accessor,
      (s, p, h) => new G.ISteamApps(s, p, h),
    );
  }

  get userStats(): G.ISteamUserStats {
    return this.#iface(
      "ISteamUserStats",
      G.ISteamUserStats_symbols,
      G.ISteamUserStats.accessor,
      (s, p, h) => new G.ISteamUserStats(s, p, h),
    );
  }

  get remoteStorage(): G.ISteamRemoteStorage {
    return this.#iface(
      "ISteamRemoteStorage",
      G.ISteamRemoteStorage_symbols,
      G.ISteamRemoteStorage.accessor,
      (s, p, h) => new G.ISteamRemoteStorage(s, p, h),
    );
  }

  get ugc(): G.ISteamUGC {
    return this.#iface(
      "ISteamUGC",
      G.ISteamUGC_symbols,
      G.ISteamUGC.accessor,
      (s, p, h) => new G.ISteamUGC(s, p, h),
    );
  }

  get input(): G.ISteamInput {
    return this.#iface(
      "ISteamInput",
      G.ISteamInput_symbols,
      G.ISteamInput.accessor,
      (s, p, h) => new G.ISteamInput(s, p, h),
    );
  }

  get matchmaking(): G.ISteamMatchmaking {
    return this.#iface(
      "ISteamMatchmaking",
      G.ISteamMatchmaking_symbols,
      G.ISteamMatchmaking.accessor,
      (s, p, h) => new G.ISteamMatchmaking(s, p, h),
    );
  }
}

function copyParam(ptr: Deno.PointerValue, size: number): Uint8Array {
  if (ptr === null || size <= 0) return new Uint8Array(0);
  const view = new Deno.UnsafePointerView(ptr);
  return new Uint8Array(view.getArrayBuffer(size).slice(0));
}
