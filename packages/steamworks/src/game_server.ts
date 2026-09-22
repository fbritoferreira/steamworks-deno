/**
 * A dedicated game server's connection to Steam.
 *
 * A server is not a client: it initialises through its own entry point, gets a different
 * set of interfaces, and pumps its own callback pipe. Everything else, the manual dispatch
 * loop and the decoded callbacks, works exactly as it does for a client.
 */
import {
  CORE_SYMBOLS,
  LibraryHandle,
  type ResolveLibraryOptions,
  resolveLibraryPath,
} from "./lib.ts";
import { cstr, readFixedString } from "./cstring.ts";
import { SteamInitError, SteamInitResult, SteamInterfaceError } from "./errors.ts";
import { type AnyCallbackListener, type CallbackListener, Dispatcher } from "./dispatch.ts";
import { PACK } from "./layout.ts";
import {
  CallbackMsg_t_layout,
  decodeCallbackMsg_t,
  decodeSteamAPICallCompleted_t,
} from "../gen/structs.ts";
import { CallbackDecoders, CallbackId, type CallbackMap } from "../gen/callback_ids.ts";
import { ALL_INTERFACE_SYMBOLS } from "../gen/all_symbols.ts";
import {
  GAME_SERVER_INTERFACE_VERSIONS,
  SteamGameServerInterfaces,
} from "../gen/game_server_base.ts";
import * as G from "../gen/mod.ts";

/** How a server presents itself to Steam and to players browsing the server list. */
export enum ServerMode {
  /** Do not authenticate logins, and stay off the server list. */
  NoAuthentication = 1,
  /** Authenticate users and list the server, without VAC. */
  Authentication = 2,
  /** Authenticate users, list the server, and VAC protect the clients that connect. */
  AuthenticationAndSecure = 3,
}

export interface SteamGameServerOptions extends ResolveLibraryOptions {
  /** Your Steam AppID. */
  appId: number;
  /** The address to bind, as a host-order IPv4 integer. 0 means every interface. */
  ip?: number;
  /** The UDP port players send game traffic to. */
  gamePort: number;
  /** The UDP port the server browser queries. Pass the game port to share one socket. */
  queryPort: number;
  /** How the server authenticates and lists itself. */
  serverMode?: ServerMode;
  /** Your server's version, which Steam compares against the one listed for the app. */
  versionString: string;
  /** Reject a call result Steam never completes, in milliseconds. 0 waits indefinitely. */
  callResultTimeoutMs?: number;
}

const SYMBOLS = { ...CORE_SYMBOLS, ...ALL_INTERFACE_SYMBOLS } as const;
type Core = Deno.DynamicLibrary<typeof SYMBOLS>["symbols"];

/**
 * A connected game server.
 *
 * ```ts
 * const server = SteamGameServerClient.init({
 *   appId: 480,
 *   gamePort: 27015,
 *   queryPort: 27016,
 *   versionString: "1.0.0.0",
 * });
 * server.gameServer.setServerName("My server");
 * server.runCallbacks();
 * ```
 */
export class SteamGameServerClient extends SteamGameServerInterfaces {
  readonly libraryPath: string;

  readonly #handle: LibraryHandle;
  readonly #core: Core;
  readonly #pipe: number;
  readonly #dispatcher = new Dispatcher();
  readonly #msgBuf = new Uint8Array(CallbackMsg_t_layout[PACK].size);
  readonly #interfaces = new Map<string, unknown>();
  readonly #callResultTimeoutMs: number;
  #closed = false;

  private constructor(
    handle: LibraryHandle,
    core: Core,
    pipe: number,
    callResultTimeoutMs: number,
  ) {
    super();
    this.#handle = handle;
    this.#core = core;
    this.#pipe = pipe;
    this.#callResultTimeoutMs = callResultTimeoutMs;
    this.libraryPath = handle.path;
  }

  /** Start the server's connection to Steam. */
  static init(opts: SteamGameServerOptions): SteamGameServerClient {
    const handle = new LibraryHandle(resolveLibraryPath(opts));
    Deno.env.set("SteamAppId", String(opts.appId));
    Deno.env.set("SteamGameId", String(opts.appId));

    const core = handle.open(SYMBOLS).symbols;
    try {
      const errBuf = new Uint8Array(1024);
      const result = core.SteamInternal_GameServer_Init_V2(
        opts.ip ?? 0,
        opts.gamePort,
        opts.queryPort,
        opts.serverMode ?? ServerMode.Authentication,
        cstr(opts.versionString),
        interfaceVersionList(),
        errBuf,
      ) as SteamInitResult;
      if (result !== SteamInitResult.OK) {
        throw new SteamInitError(
          result,
          readFixedString(errBuf, 0, errBuf.length),
          "SteamInternal_GameServer_Init_V2",
        );
      }
      core.SteamAPI_ManualDispatch_Init();
      const server = new SteamGameServerClient(
        handle,
        core,
        core.SteamGameServer_GetHSteamPipe(),
        opts.callResultTimeoutMs ?? 120_000,
      );
      server.runCallbacks();
      return server;
    } catch (e) {
      handle.closeAll();
      throw e;
    }
  }

  /** True until {@link shutdown} runs. */
  get isRunning(): boolean {
    return !this.#closed;
  }

  /** The server's own SteamID, once Steam has issued one. */
  steamId(): bigint {
    this.#assertOpen();
    return this.#core.SteamGameServer_GetSteamID();
  }

  /** Whether VAC accepted this server as secure. */
  isSecure(): boolean {
    this.#assertOpen();
    return this.#core.SteamGameServer_BSecure();
  }

  /** Subscribe to a callback by name and receive it decoded. */
  onCallback<K extends keyof CallbackMap>(
    name: K,
    listener: (data: CallbackMap[K]) => void,
  ): () => void {
    const id = CallbackId[name as keyof typeof CallbackId] as number;
    const decode = CallbackDecoders[id] as (bytes: Uint8Array) => CallbackMap[K];
    return this.#dispatcher.on(id, (bytes) => listener(decode(bytes)));
  }

  /** Subscribe to one callback id and receive its raw bytes. */
  on(callbackId: number, listener: CallbackListener): () => void {
    return this.#dispatcher.on(callbackId, listener);
  }

  /** Observe every callback that arrives. */
  onAny(listener: AnyCallbackListener): () => void {
    return this.#dispatcher.onAny(listener);
  }

  /** Turn a call handle into a promise for its decoded result. */
  callResult<T>(handle: bigint, callbackId: number, decode: (bytes: Uint8Array) => T): Promise<T> {
    this.#assertOpen();
    return this.#dispatcher.waitFor(handle, callbackId, this.#callResultTimeoutMs).then(decode);
  }

  /** Drain the server's callback queue once. Call it on every tick. */
  runCallbacks(): number {
    this.#assertOpen();
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

  shutdown(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#dispatcher.rejectAll(new Error("SteamGameServerClient shut down"));
    this.#interfaces.clear();
    this.#core.SteamGameServer_Shutdown();
    this.#handle.closeAll();
  }

  #completeCall(param: Uint8Array): void {
    const completed = decodeSteamAPICallCompleted_t(param);
    const pending = this.#dispatcher.takePending(completed.m_hAsyncCall);
    if (!pending) return;
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
    } else {
      pending.resolve(out);
    }
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new Error(
        "This SteamGameServerClient has been shut down. Calling into Steam now would reach " +
          "a closed library and crash the process, so the call was refused instead.",
      );
    }
  }

  protected override iface<S extends Deno.ForeignLibraryInterface, T>(
    name: string,
    _symbols: S,
    accessor: string,
    make: (s: Deno.DynamicLibrary<S>["symbols"], self: Deno.PointerValue, host: never) => T,
  ): T {
    this.#assertOpen();
    const hit = this.#interfaces.get(name);
    if (hit) return hit as T;
    const s = this.#core as unknown as Record<string, unknown>;
    const get = s[accessor] as (() => Deno.PointerValue) | null | undefined;
    const self = get?.() ?? null;
    if (self === null) throw new SteamInterfaceError(name, accessor, G.SDK_VERSION);
    const made = make(
      this.#core as unknown as Deno.DynamicLibrary<S>["symbols"],
      self,
      this as never,
    );
    this.#interfaces.set(name, made);
    return made;
  }
}

/** The versions Steam checks, NUL separated and terminated by a second NUL. */
export function interfaceVersionList(
  versions: readonly string[] = GAME_SERVER_INTERFACE_VERSIONS,
): Uint8Array {
  return new TextEncoder().encode(`${versions.join("\0")}\0\0`);
}

function copyParam(ptr: Deno.PointerValue, size: number): Uint8Array {
  if (ptr === null || size <= 0) return new Uint8Array(0);
  return new Uint8Array(new Deno.UnsafePointerView(ptr).getArrayBuffer(size).slice(0));
}
