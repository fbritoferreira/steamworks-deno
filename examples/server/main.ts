/**
 * A dedicated game server you can run in a terminal, with no desktop Steam client anywhere.
 *
 *   STEAMWORKS_SDK_PATH=./sdk deno task server
 *
 * A server is not a client: it initialises through its own entry point and needs the standalone
 * `steamclient` library steamcmd ships, placed where libsteam_api looks for it — the working
 * directory on macOS, `~/.steam/sdk64` on Linux. Fetch it anonymously with steamcmd
 * (`steamcmd +login anonymous +quit` unpacks the bootstrapper) or depot 1007. It logs on
 * anonymously to AppID 480, Valve's public Spacewar test app: enough to prove the server works,
 * not enough to serve a real game — that needs your app's own game-server login.
 *
 * Binds UDP 27015 and 27016, which must be free. Ctrl-C shuts it down.
 */
import { ServerMode, SteamGameServerClient } from "@steamworks/deno";

const server = SteamGameServerClient.init({
  appId: 480,
  gamePort: 27015,
  queryPort: 27016,
  serverMode: ServerMode.NoAuthentication,
  versionString: "1.0.0.0",
});
console.log("init        :", server.libraryPath);

let logon = "";
server.onCallback("SteamServersConnected", () => {
  logon = "connected";
});
server.onCallback("SteamServerConnectFailure", (data) => {
  logon = `refused: result ${data.m_eResult}`;
});

console.log("-> logOnAnonymous()");
server.gameServer.logOnAnonymous();

const deadline = Date.now() + 30_000;
while (!logon && Date.now() < deadline) {
  server.runCallbacks();
  if (!logon) await new Promise((r) => setTimeout(r, 50));
}
if (logon !== "connected") {
  console.log(`logon       : ${logon || "no logon callback arrived within 30 seconds"}`);
  server.shutdown();
  Deno.exit(1);
}
console.log("<- SteamServersConnected_t");

console.log("steamId     :", server.steamId().toString());
server.gameServer.setServerName("steamworks-deno example server");
console.log("name        : steamworks-deno example server");
console.log("appId       :", server.utils.getAppID(), "(", server.utils.getIPCountry(), ")");

let running = true;
Deno.addSignalListener("SIGINT", () => {
  running = false;
});

let tick = 0;
while (running) {
  server.runCallbacks();
  if (++tick % 20 === 0) console.log(`heartbeat   : tick ${tick}, still pumping`);
  await new Promise((r) => setTimeout(r, 250));
}

console.log("\n-> SIGINT; shutting down");
server.shutdown();
try {
  server.steamId();
  console.log("refused     : no — steamId still answered after shutdown?!");
  Deno.exit(1);
} catch (e) {
  console.log("refused     :", (e as Error).message);
}
console.log("\nDedicated server OK");
