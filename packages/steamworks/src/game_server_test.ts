/**
 * The game server path: its own init, its own pipe, its own interfaces.
 *
 * Starting a server binds UDP ports and registers with Steam, so the live test runs only
 * when the SDK is present. The version list is pure and always checked.
 */
import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { interfaceVersionList, ServerMode, SteamGameServerClient } from "./game_server.ts";
import { GAME_SERVER_INTERFACE_VERSIONS } from "../gen/game_server_base.ts";

const sdk = Deno.env.get("STEAMWORKS_SDK_PATH");

Deno.test("the version list is NUL separated and ends with a second NUL", () => {
  const bytes = interfaceVersionList(["A", "B"]);
  assertEquals(Array.from(bytes), [65, 0, 66, 0, 0]);
});

Deno.test("the generated versions cover what the SDK header passes", () => {
  const joined = GAME_SERVER_INTERFACE_VERSIONS.join(" ");
  assertEquals(GAME_SERVER_INTERFACE_VERSIONS.length, 10);
  assertStringIncludes(joined, "SteamGameServer015");
  assertStringIncludes(joined, "SteamGameServerStats001");
  assertStringIncludes(joined, "SteamUtils011");
});

Deno.test("server modes match the SDK's EServerMode", () => {
  assertEquals(ServerMode.NoAuthentication, 1);
  assertEquals(ServerMode.Authentication, 2);
  assertEquals(ServerMode.AuthenticationAndSecure, 3);
});

Deno.test({
  name: "a game server starts, reaches its interfaces, and shuts down",
  ignore: !sdk,
  fn() {
    const server = SteamGameServerClient.init({
      appId: 480,
      gamePort: 27015,
      queryPort: 27016,
      serverMode: ServerMode.NoAuthentication,
      versionString: "1.0.0.0",
      sdkPath: sdk,
    });
    try {
      assertEquals(server.isRunning, true);
      // The two interfaces only a server gets. These work wherever a server can start.
      assertEquals(typeof server.gameServer.setServerName, "function");
      assertEquals(typeof server.gameServerStats.setUserStatInt32, "function");
      assertEquals(server.runCallbacks() >= 0, true);
      assertEquals(typeof server.isSecure(), "boolean");
      assertEquals(typeof server.steamId(), "bigint");

      // The seven interfaces a server shares with a client answer null here. A dedicated
      // server reaches them through its own steamclient library, which a development
      // machine running the Steam client does not provide, so this records the behaviour
      // rather than asserting either way.
      try {
        server.http.createHTTPRequest(1, "https://example.com");
      } catch (e) {
        assertStringIncludes((e as Error).message, "SteamAPI_SteamGameServerHTTP");
      }
    } finally {
      server.shutdown();
    }
    assertEquals(server.isRunning, false);
    assertThrows(() => server.gameServer.setServerName("x"), Error, "has been shut down");
  },
});
