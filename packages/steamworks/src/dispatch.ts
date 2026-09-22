/**
 * Pure bookkeeping for manual callback dispatch: listeners keyed by callback id,
 * and pending CallResults keyed by `SteamAPICall_t`. No FFI here, so it is unit-testable.
 */

/** Receives one callback's raw payload bytes. */
export type CallbackListener = (param: Uint8Array) => void;
/** Receives every callback, with the id that identifies it. */
export type AnyCallbackListener = (callbackId: number, param: Uint8Array) => void;

/** A call result nobody has answered yet. */
export interface PendingCall {
  callbackId: number;
  resolve: (param: Uint8Array) => void;
  reject: (err: Error) => void;
}

/**
 * Bookkeeping for callbacks and call results: which listeners want which callback id, and
 * which promise is waiting on which `SteamAPICall_t`. Holds no FFI state, so it is testable
 * without a Steam client.
 */
export class Dispatcher {
  #listeners = new Map<number, Set<CallbackListener>>();
  #anyListeners = new Set<AnyCallbackListener>();
  #pending = new Map<bigint, PendingCall>();

  on(callbackId: number, listener: CallbackListener): () => void {
    let set = this.#listeners.get(callbackId);
    if (!set) {
      set = new Set();
      this.#listeners.set(callbackId, set);
    }
    set.add(listener);
    return () => set?.delete(listener);
  }

  /** Observe every callback (including ones nobody subscribed to). Handy for diagnostics. */
  onAny(listener: AnyCallbackListener): () => void {
    this.#anyListeners.add(listener);
    return () => this.#anyListeners.delete(listener);
  }

  emit(callbackId: number, param: Uint8Array): number {
    for (const listener of this.#anyListeners) listener(callbackId, param);
    const set = this.#listeners.get(callbackId);
    if (!set) return this.#anyListeners.size;
    for (const listener of set) listener(param);
    return set.size + this.#anyListeners.size;
  }

  /**
   * Register a call result and get a promise for its raw struct bytes.
   *
   * `timeoutMs` rejects the promise if Steam never completes the call, which otherwise
   * leaves it pending for the life of the process. Pass 0 to wait indefinitely.
   */
  waitFor(handle: bigint, callbackId: number, timeoutMs = 0): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      if (handle === 0n) {
        reject(new Error("Steam returned an invalid SteamAPICall_t (0)"));
        return;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (fn: () => void) => {
        if (timer !== undefined) clearTimeout(timer);
        this.#pending.delete(handle);
        fn();
      };
      const entry: PendingCall = {
        callbackId,
        resolve: (bytes) => settle(() => resolve(bytes)),
        reject: (err) => settle(() => reject(err)),
      };
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          entry.reject(
            new Error(
              `Steam call ${handle} did not complete within ${timeoutMs}ms. ` +
                `Callbacks are only delivered while runCallbacks() is being called.`,
            ),
          );
        }, timeoutMs);
        // Do not hold the process open waiting for a call result.
        Deno.unrefTimer(timer);
      }
      this.#pending.set(handle, entry);
    });
  }

  /** Look up (and remove) the pending call for a completed handle. */
  takePending(handle: bigint): PendingCall | undefined {
    const p = this.#pending.get(handle);
    if (p) this.#pending.delete(handle);
    return p;
  }

  get pendingCount(): number {
    return this.#pending.size;
  }

  /** Reject everything outstanding, e.g. on shutdown. */
  rejectAll(reason: Error): void {
    for (const p of this.#pending.values()) p.reject(reason);
    this.#pending.clear();
  }
}
