/**
 * The encrypted app ticket path: request, pull, decrypt.
 *
 * The pure logic — platform file names, resolution order, the marshalling around each
 * accessor — runs against a fake dlopen everywhere. The live test runs only when
 * STEAMWORKS_SDK_PATH is set and Steam is running and logged in, like client_test.ts.
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { write } from "./layout.ts";
import {
  k_nSteamEncryptedAppTicketSymmetricKeyLen,
  resolveTicketLibraryPath,
  SteamEncryptedAppTicket,
  type SteamEncryptedAppTicketOptions,
  ticketLibraryFileName,
  ticketLibraryPath,
} from "./encrypted_app_ticket.ts";
import { SteamClient } from "./client.ts";
import { EResult } from "../gen/enums.ts";

const sdk = Deno.env.get("STEAMWORKS_SDK_PATH");
const mac = { os: "darwin", arch: "aarch64" };
const noEnv = () => undefined;

Deno.test("ticketLibraryPath maps platforms", () => {
  assertEquals(ticketLibraryPath(mac), "public/steam/lib/osx/libsdkencryptedappticket.dylib");
  assertEquals(
    ticketLibraryPath({ os: "linux", arch: "x86_64" }),
    "public/steam/lib/linux64/libsdkencryptedappticket.so",
  );
  assertEquals(
    ticketLibraryPath({ os: "linux", arch: "aarch64" }),
    "public/steam/lib/linuxarm64/libsdkencryptedappticket.so",
  );
  assertEquals(
    ticketLibraryPath({ os: "windows", arch: "x86_64" }),
    "public/steam/lib/win64/sdkencryptedappticket64.dll",
  );
  assertThrows(() => ticketLibraryPath({ os: "freebsd", arch: "x86_64" }));
});

Deno.test("ticketLibraryFileName covers every platform Deno targets", () => {
  assertEquals(
    ticketLibraryFileName({ os: "darwin", arch: "aarch64" }),
    "libsdkencryptedappticket.dylib",
  );
  assertEquals(
    ticketLibraryFileName({ os: "linux", arch: "x86_64" }),
    "libsdkencryptedappticket.so",
  );
  assertEquals(
    ticketLibraryFileName({ os: "linux", arch: "aarch64" }),
    "libsdkencryptedappticket.so",
  );
  assertEquals(
    ticketLibraryFileName({ os: "windows", arch: "x86_64" }),
    "sdkencryptedappticket64.dll",
  );
});

Deno.test("resolveTicketLibraryPath: explicit libraryPath wins", () => {
  const opts: SteamEncryptedAppTicketOptions = {
    libraryPath: "/x/libsdkencryptedappticket.dylib",
    sdkPath: "/sdk",
    build: mac,
    env: noEnv,
  };
  assertEquals(resolveTicketLibraryPath(opts), "/x/libsdkencryptedappticket.dylib");
});

Deno.test("resolveTicketLibraryPath: sdkPath appends platform path", () => {
  assertEquals(
    resolveTicketLibraryPath({ sdkPath: "/sdk/", build: mac, env: noEnv }),
    "/sdk/public/steam/lib/osx/libsdkencryptedappticket.dylib",
  );
});

Deno.test("resolveTicketLibraryPath: env fallbacks in order", () => {
  const env = (k: string) => ({ STEAMWORKS_SDK_PATH: "/env-sdk" } as Record<string, string>)[k];
  assertEquals(
    resolveTicketLibraryPath({ build: mac, env }),
    "/env-sdk/public/steam/lib/osx/libsdkencryptedappticket.dylib",
  );
  const env2 = (k: string) =>
    ({ STEAMWORKS_TICKET_LIB_PATH: "/direct.so", STEAMWORKS_SDK_PATH: "/env-sdk" } as Record<
      string,
      string
    >)[k];
  assertEquals(resolveTicketLibraryPath({ build: mac, env: env2 }), "/direct.so");
});

Deno.test("resolveTicketLibraryPath: throws with download hint when nothing set", () => {
  assertThrows(
    () => resolveTicketLibraryPath({ build: mac, env: noEnv }),
    Error,
    "steamworks_sdk.zip",
  );
});

const okKey = new Uint8Array(k_nSteamEncryptedAppTicketSymmetricKeyLen).fill(7);

const cannedSymbols = {
  SteamEncryptedAppTicket_BDecryptTicket: (
    _encrypted: Uint8Array,
    _encLength: number,
    out: Uint8Array,
    size: Uint8Array,
    key: Uint8Array,
  ): boolean => {
    if (key !== okKey) return false;
    out.set([9, 8, 7, 6, 5]);
    write.u32(size, 0, 5);
    return true;
  },
  SteamEncryptedAppTicket_BIsTicketForApp: (
    _ticket: Uint8Array,
    _length: number,
    appId: number,
  ): boolean => appId === 480,
  SteamEncryptedAppTicket_GetTicketIssueTime: (): number => 1_234_567_890,
  SteamEncryptedAppTicket_GetTicketSteamID: (
    _ticket: Uint8Array,
    _length: number,
    out: Uint8Array,
  ): void => {
    write.u64(out, 0, 76561198312345678n);
  },
  SteamEncryptedAppTicket_GetTicketAppID: (): number => 480,
  SteamEncryptedAppTicket_BUserOwnsAppInTicket: (
    _ticket: Uint8Array,
    _length: number,
    appId: number,
  ): boolean => appId === 480,
  SteamEncryptedAppTicket_BUserIsVacBanned: (): boolean => false,
  SteamEncryptedAppTicket_BGetAppDefinedValue: (
    _ticket: Uint8Array,
    _length: number,
    out: Uint8Array,
  ): boolean => {
    write.u32(out, 0, 42);
    return true;
  },
  SteamEncryptedAppTicket_GetUserVariableData: (
    _ticket: Uint8Array,
    _length: number,
    size: Uint8Array,
  ): null => {
    write.u32(size, 0, 0);
    return null;
  },
  SteamEncryptedAppTicket_BIsTicketSigned: (): boolean => true,
  SteamEncryptedAppTicket_BIsLicenseBorrowed: (): boolean => false,
  SteamEncryptedAppTicket_BIsLicenseTemporary: (): boolean => true,
};

function fakeLib(
  symbols: Record<string, unknown>,
  log: string[],
): <S extends Deno.ForeignLibraryInterface>(
  path: string,
  table: S,
) => Deno.DynamicLibrary<S> {
  return <S extends Deno.ForeignLibraryInterface>(path: string, table: S) => {
    log.push(`open ${path}:${Object.keys(table).length}`);
    return { symbols, close: () => log.push("close") } as unknown as Deno.DynamicLibrary<S>;
  };
}

Deno.test("the accessors marshal what the library writes", () => {
  const log: string[] = [];
  const ticket = new SteamEncryptedAppTicket("/ticket.dylib", fakeLib(cannedSymbols, log));
  assertEquals(ticket.isOpen, true);
  assertEquals(log, ["open /ticket.dylib:12"]);

  const decrypted = ticket.decryptTicket(new Uint8Array([1, 2, 3, 4, 5, 6]), okKey);
  assertEquals(Array.from(decrypted ?? []), [9, 8, 7, 6, 5]);

  const ticketBytes = new Uint8Array(8);
  assertEquals(ticket.isTicketForApp(ticketBytes, 480), true);
  assertEquals(ticket.getTicketIssueTime(ticketBytes), 1_234_567_890);
  assertEquals(ticket.getTicketSteamID(ticketBytes), 76561198312345678n);
  assertEquals(ticket.getTicketAppID(ticketBytes), 480);
  assertEquals(ticket.userOwnsAppInTicket(ticketBytes, 480), true);
  assertEquals(ticket.userIsVacBanned(ticketBytes), false);
  assertEquals(ticket.getAppDefinedValue(ticketBytes), { ok: true, value: 42 });
  assertEquals(ticket.getUserVariableData(ticketBytes), new Uint8Array(0));
  assertEquals(ticket.isTicketSigned(ticketBytes, new Uint8Array(64)), true);
  assertEquals(ticket.isLicenseBorrowed(ticketBytes), false);
  assertEquals(ticket.isLicenseTemporary(ticketBytes), true);

  ticket.close();
  assertEquals(ticket.isOpen, false);
  assertEquals(log, ["open /ticket.dylib:12", "close"]);
});

Deno.test("decryptTicket returns null when the library refuses the key", () => {
  const ticket = new SteamEncryptedAppTicket("/ticket.dylib", fakeLib(cannedSymbols, []));
  assertEquals(ticket.decryptTicket(new Uint8Array(6), new Uint8Array(32)), null);
});

Deno.test("decryptTicket refuses a key that is not the header's 32 bytes", () => {
  const ticket = new SteamEncryptedAppTicket("/ticket.dylib", fakeLib(cannedSymbols, []));
  assertThrows(
    () => ticket.decryptTicket(new Uint8Array(6), new Uint8Array(31)),
    Error,
    "32 bytes",
  );
});

Deno.test("every accessor refuses after close", () => {
  const ticket = new SteamEncryptedAppTicket("/ticket.dylib", fakeLib(cannedSymbols, []));
  ticket.close();
  ticket.close(); // closing twice is a no-op
  assertEquals(ticket.isOpen, false);
  assertThrows(() => ticket.decryptTicket(new Uint8Array(6), okKey), Error, "has been closed");
  assertThrows(() => ticket.isTicketForApp(new Uint8Array(8), 480), Error, "has been closed");
});

/**
 * The live round trip: request a ticket for Spacewar, pull its bytes, hand them to the
 * decrypt with a dummy key.
 *
 * The honest thing testable without owning the app: AppID 480 is not ours, its secret key
 * belongs to Valve, and nobody outside can decrypt its tickets. So `decryptTicket` must
 * return null here — which still proves the FFI signatures, the ticket request flow, and
 * the decrypt entry point end-to-end.
 */
Deno.test({
  name: "a requested ticket arrives, and a wrong key cannot decrypt it",
  ignore: !sdk,
  async fn() {
    const steam = SteamClient.init({ appId: 480, sdkPath: sdk });
    const stop = steam.startPump();
    try {
      // A call result: this promise settles during a later runCallbacks().
      const ready = await steam.user.requestEncryptedAppTicket(new Uint8Array([1, 2, 3]), 3);
      assertEquals(ready.m_eResult, EResult.k_EResultOK);

      let buf = new Uint8Array(1024);
      let pulled = steam.user.getEncryptedAppTicket(buf, buf.length);
      if (!pulled.ok && pulled.pcbTicket > 0) {
        buf = new Uint8Array(pulled.pcbTicket);
        pulled = steam.user.getEncryptedAppTicket(buf, buf.length);
      }
      assert(pulled.ok, "the ticket comes back out");
      assert(pulled.pcbTicket > 0, "the ticket has bytes in it");
      const encrypted = buf.subarray(0, pulled.pcbTicket);

      const ticket = SteamEncryptedAppTicket.open({ sdkPath: sdk });
      try {
        assertEquals(ticket.decryptTicket(encrypted, new Uint8Array(32)), null);
      } finally {
        ticket.close();
      }
    } finally {
      stop();
      steam.shutdown();
    }
  },
});
