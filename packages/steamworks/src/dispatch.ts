/**
 * Pure bookkeeping for manual callback dispatch: listeners keyed by callback id,
 * and pending CallResults keyed by `SteamAPICall_t`. No FFI here, so it is unit-testable.
 */

export type CallbackListener = (param: Uint8Array) => void;
export type AnyCallbackListener = (callbackId: number, param: Uint8Array) => void;

export interface PendingCall {
  callbackId: number;
  resolve: (param: Uint8Array) => void;
  reject: (err: Error) => void;
}

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

  /** Register a CallResult and get a promise for its raw struct bytes. */
  waitFor(handle: bigint, callbackId: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      if (handle === 0n) {
        reject(new Error("Steam returned an invalid SteamAPICall_t (0)"));
        return;
      }
      this.#pending.set(handle, { callbackId, resolve, reject });
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
