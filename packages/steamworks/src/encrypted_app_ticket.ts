/**
 * Hand-written bindings for `sdkencryptedappticket`, the SDK's second library: the one that
 * decrypts and checks the tickets `ISteamUser::RequestEncryptedAppTicket` hands out.
 *
 * `steam_api.json` does not describe this library, so nothing here is generated. The flat C API
 * comes from `steamencryptedappticket.h`, and every declaration mirrors the generated
 * bindings' style.
 */
import { write } from "./layout.ts";
import { readScalar, scalarOut } from "./marshal.ts";

/**
 * Length in bytes of the symmetric key `BDecryptTicket` expects: your app's secret key, from
 * its Steamworks partner page.
 */
export const k_nSteamEncryptedAppTicketSymmetricKeyLen = 32;

/** The flat C API of the ticket library, as `steamencryptedappticket.h` declares it. */
export const TICKET_SYMBOLS = {
  SteamEncryptedAppTicket_BDecryptTicket: {
    parameters: ["buffer", "u32", "buffer", "buffer", "buffer", "i32"],
    result: "bool",
  },
  SteamEncryptedAppTicket_BIsTicketForApp: { parameters: ["buffer", "u32", "u32"], result: "bool" },
  SteamEncryptedAppTicket_GetTicketIssueTime: { parameters: ["buffer", "u32"], result: "u32" },
  SteamEncryptedAppTicket_GetTicketSteamID: {
    parameters: ["buffer", "u32", "buffer"],
    result: "void",
  },
  SteamEncryptedAppTicket_GetTicketAppID: { parameters: ["buffer", "u32"], result: "u32" },
  SteamEncryptedAppTicket_BUserOwnsAppInTicket: {
    parameters: ["buffer", "u32", "u32"],
    result: "bool",
  },
  SteamEncryptedAppTicket_BUserIsVacBanned: { parameters: ["buffer", "u32"], result: "bool" },
  SteamEncryptedAppTicket_BGetAppDefinedValue: {
    parameters: ["buffer", "u32", "buffer"],
    result: "bool",
  },
  SteamEncryptedAppTicket_GetUserVariableData: {
    parameters: ["buffer", "u32", "buffer"],
    result: "pointer",
  },
  SteamEncryptedAppTicket_BIsTicketSigned: {
    parameters: ["buffer", "u32", "buffer", "u32"],
    result: "bool",
  },
  SteamEncryptedAppTicket_BIsLicenseBorrowed: { parameters: ["buffer", "u32"], result: "bool" },
  SteamEncryptedAppTicket_BIsLicenseTemporary: { parameters: ["buffer", "u32"], result: "bool" },
} as const satisfies Deno.ForeignLibraryInterface;

/** Where to find the encrypted app ticket library. */
export interface SteamEncryptedAppTicketOptions {
  /**
   * Absolute path to libsdkencryptedappticket.dylib / libsdkencryptedappticket.so /
   * sdkencryptedappticket64.dll. Wins over everything.
   */
  libraryPath?: string;
  /** Root of an unzipped Steamworks SDK (the folder containing `public/`). */
  sdkPath?: string;
  /** Override `Deno.build` for testing. */
  build?: { os: string; arch: string };
  /** Override env lookup for testing. */
  env?: (key: string) => string | undefined;
}

/** Relative path of the ticket library inside the SDK for a given platform. */
export function ticketLibraryPath(build: { os: string; arch: string } = Deno.build): string {
  const { os, arch } = build;
  if (os === "darwin") return "public/steam/lib/osx/libsdkencryptedappticket.dylib";
  if (os === "linux" && arch === "x86_64") {
    return "public/steam/lib/linux64/libsdkencryptedappticket.so";
  }
  if (os === "linux" && arch === "aarch64") {
    return "public/steam/lib/linuxarm64/libsdkencryptedappticket.so";
  }
  if (os === "windows" && arch === "x86_64") {
    return "public/steam/lib/win64/sdkencryptedappticket64.dll";
  }
  throw new Error(`Unsupported platform for the ticket library: ${os}/${arch}`);
}

/**
 * Decide where to load the ticket library from. Precedence:
 * 1. `libraryPath` option
 * 2. `sdkPath` option
 * 3. `STEAMWORKS_TICKET_LIB_PATH` env var
 * 4. `STEAMWORKS_SDK_PATH` env var
 */
export function resolveTicketLibraryPath(opts: SteamEncryptedAppTicketOptions = {}): string {
  const build = opts.build ?? Deno.build;
  const env = opts.env ?? ((k: string) => Deno.env.get(k));
  if (opts.libraryPath) return opts.libraryPath;
  if (opts.sdkPath) return join(opts.sdkPath, ticketLibraryPath(build));
  const envLib = env("STEAMWORKS_TICKET_LIB_PATH");
  if (envLib) return envLib;
  const envSdk = env("STEAMWORKS_SDK_PATH");
  if (envSdk) return join(envSdk, ticketLibraryPath(build));
  throw new Error(
    "Cannot locate the encrypted app ticket library. Pass `libraryPath` or `sdkPath` to " +
      "SteamEncryptedAppTicket.open, or set STEAMWORKS_TICKET_LIB_PATH / STEAMWORKS_SDK_PATH. " +
      "Download the SDK from https://partner.steamgames.com/downloads/steamworks_sdk.zip",
  );
}

/** File name of the ticket library on one platform, as the SDK ships it. */
export function ticketLibraryFileName(build: { os: string; arch: string } = Deno.build): string {
  const rel = ticketLibraryPath(build);
  return rel.slice(rel.lastIndexOf("/") + 1);
}

type DlOpen = <S extends Deno.ForeignLibraryInterface>(
  path: string,
  symbols: S,
) => Deno.DynamicLibrary<S>;

/**
 * Valve's `sdkencryptedappticket` library: utilities to decode and decrypt a ticket from the
 * `ISteamUser::RequestEncryptedAppTicket` / `GetEncryptedAppTicket` API.
 *
 * The library is separate from `libsteam_api` and never talks to the Steam client — it is pure
 * crypto over ticket bytes — so it needs no `SteamAPI_Init` and no running Steam. A backend
 * holding a ticket and the app's secret key can verify it with nothing else.
 *
 * To use, as the header puts it: call {@link SteamEncryptedAppTicket.decryptTicket}; if it
 * returns bytes, the other accessors are valid on those bytes.
 *
 * ```ts
 * const ticket = SteamEncryptedAppTicket.open();
 * const decrypted = ticket.decryptTicket(encrypted, secretKey);
 * if (decrypted) console.log(ticket.getTicketSteamID(decrypted));
 * ticket.close();
 * ```
 */
export class SteamEncryptedAppTicket {
  #lib: Deno.DynamicLibrary<typeof TICKET_SYMBOLS> | undefined;

  /**
   * @param path The ticket library file to open.
   * @param dlopen Override `Deno.dlopen`, for testing.
   */
  constructor(readonly path: string, dlopen: DlOpen = Deno.dlopen) {
    this.#lib = dlopen(path, TICKET_SYMBOLS);
  }

  /**
   * Resolve the library and open it in one step, the way `SteamClient.init` does. It loads
   * from the `libraryPath` or `sdkPath` option, else `STEAMWORKS_TICKET_LIB_PATH`, else
   * `STEAMWORKS_SDK_PATH`.
   */
  static open(opts: SteamEncryptedAppTicketOptions = {}): SteamEncryptedAppTicket {
    return new SteamEncryptedAppTicket(resolveTicketLibraryPath(opts));
  }

  /** True until {@link SteamEncryptedAppTicket.close} runs. */
  get isOpen(): boolean {
    return this.#lib !== undefined;
  }

  /** Close the library. Every accessor refuses afterwards rather than call into freed memory. */
  close(): void {
    this.#lib?.close();
    this.#lib = undefined;
  }

  #symbols(): Deno.DynamicLibrary<typeof TICKET_SYMBOLS>["symbols"] {
    if (!this.#lib) {
      throw new Error(
        "This SteamEncryptedAppTicket has been closed. Calling into the library now would " +
          "reach a closed handle and crash the process, so the call was refused instead.",
      );
    }
    return this.#lib.symbols;
  }

  /**
   * Decrypt a ticket with your app's secret key.
   *
   * Returns the decrypted ticket bytes, or null when the library refuses the pair: the key
   * does not belong to the app that issued the ticket, or the bytes are not a ticket. Only
   * when bytes come back are the other accessors valid. The header does not say whether the
   * length parameter is in or out, so it is seeded with the buffer capacity — the decrypted
   * ticket is never larger than the encrypted one — and read back after the call.
   */
  decryptTicket(encrypted: Uint8Array, key: Uint8Array): Uint8Array | null {
    if (key.length !== k_nSteamEncryptedAppTicketSymmetricKeyLen) {
      throw new Error(
        `The ticket key must be ${k_nSteamEncryptedAppTicketSymmetricKeyLen} bytes; ` +
          `got ${key.length}.`,
      );
    }
    const decrypted = new Uint8Array(encrypted.length);
    const size = scalarOut("u32");
    write.u32(size, 0, decrypted.length);
    const ok = this.#symbols().SteamEncryptedAppTicket_BDecryptTicket(
      encrypted,
      encrypted.length,
      decrypted,
      size,
      key,
      key.length,
    );
    if (!ok) return null;
    const length = readScalar(size, "u32") as number;
    return decrypted.subarray(0, Math.min(length, decrypted.length));
  }

  /** Whether the ticket was issued for the given app. */
  isTicketForApp(decrypted: Uint8Array, appId: number): boolean {
    return this.#symbols().SteamEncryptedAppTicket_BIsTicketForApp(
      decrypted,
      decrypted.length,
      appId,
    );
  }

  /** When Steam issued the ticket, in seconds since the Unix epoch. */
  getTicketIssueTime(decrypted: Uint8Array): number {
    return this.#symbols().SteamEncryptedAppTicket_GetTicketIssueTime(decrypted, decrypted.length);
  }

  /** The SteamID of the user the ticket belongs to. */
  getTicketSteamID(decrypted: Uint8Array): bigint {
    const steamId = scalarOut("u64");
    this.#symbols().SteamEncryptedAppTicket_GetTicketSteamID(decrypted, decrypted.length, steamId);
    return readScalar(steamId, "u64") as bigint;
  }

  /** The app the ticket was issued for. */
  getTicketAppID(decrypted: Uint8Array): number {
    return this.#symbols().SteamEncryptedAppTicket_GetTicketAppID(decrypted, decrypted.length);
  }

  /** Whether the user owns the given app, as the ticket records. */
  userOwnsAppInTicket(decrypted: Uint8Array, appId: number): boolean {
    return this.#symbols().SteamEncryptedAppTicket_BUserOwnsAppInTicket(
      decrypted,
      decrypted.length,
      appId,
    );
  }

  /** Whether the user is VAC banned, as the ticket records. */
  userIsVacBanned(decrypted: Uint8Array): boolean {
    return this.#symbols().SteamEncryptedAppTicket_BUserIsVacBanned(decrypted, decrypted.length);
  }

  /**
   * The app-defined value the ticket carries. `ok` is false when the library did not find
   * one; `value` holds what it wrote out.
   */
  getAppDefinedValue(decrypted: Uint8Array): { ok: boolean; value: number } {
    const value = scalarOut("u32");
    const ok = this.#symbols().SteamEncryptedAppTicket_BGetAppDefinedValue(
      decrypted,
      decrypted.length,
      value,
    );
    return { ok, value: readScalar(value, "u32") as number };
  }

  /**
   * The bytes your app asked Steam to include when the ticket was requested — the
   * `pDataToInclude` passed to `requestEncryptedAppTicket`. Returns an empty array when the
   * ticket carries none. The pointer the library returns points into the decrypted ticket, so
   * the bytes are copied before it can go stale.
   */
  getUserVariableData(decrypted: Uint8Array): Uint8Array {
    const size = scalarOut("u32");
    const ptr = this.#symbols().SteamEncryptedAppTicket_GetUserVariableData(
      decrypted,
      decrypted.length,
      size,
    );
    const length = readScalar(size, "u32") as number;
    if (ptr === null || length === 0) return new Uint8Array(0);
    return new Uint8Array(new Deno.UnsafePointerView(ptr).getArrayBuffer(length).slice(0));
  }

  /** Whether the ticket's signature verifies against your app's RSA public key. */
  isTicketSigned(decrypted: Uint8Array, rsaPublicKey: Uint8Array): boolean {
    return this.#symbols().SteamEncryptedAppTicket_BIsTicketSigned(
      decrypted,
      decrypted.length,
      rsaPublicKey,
      rsaPublicKey.length,
    );
  }

  /** Whether the license the ticket records was borrowed, as in family sharing. */
  isLicenseBorrowed(decrypted: Uint8Array): boolean {
    return this.#symbols().SteamEncryptedAppTicket_BIsLicenseBorrowed(decrypted, decrypted.length);
  }

  /** Whether the license the ticket records is temporary, as in a free weekend. */
  isLicenseTemporary(decrypted: Uint8Array): boolean {
    return this.#symbols().SteamEncryptedAppTicket_BIsLicenseTemporary(decrypted, decrypted.length);
  }
}

function join(base: string, rel: string): string {
  const sep = base.endsWith("/") || base.endsWith("\\") ? "" : "/";
  return `${base}${sep}${rel}`;
}
