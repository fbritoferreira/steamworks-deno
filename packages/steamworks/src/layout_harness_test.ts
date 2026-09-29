import { assertEquals } from "@std/assert";
import { compareHarnessOutput, type ExpectedLayout } from "./layout_harness.ts";

const expected: Record<string, ExpectedLayout> = {
  SteamIPAddress_t: { size: 20, fields: { m_rgubIPv6: 0, m_eType: 16 } },
  FriendGameInfo_t: { size: 24, fields: { m_gameID: 0, m_steamIDLobby: 16 } },
};

const harnessOutput = [
  "SteamIPAddress_t size=20",
  "  SteamIPAddress_t.m_rgubIPv6 off=0",
  "  SteamIPAddress_t.m_eType off=16",
  "FriendGameInfo_t size=24",
  "  FriendGameInfo_t.m_gameID off=0",
  "  FriendGameInfo_t.m_steamIDLobby off=16",
].join("\n");

Deno.test("matching harness output agrees", () => {
  assertEquals(compareHarnessOutput(harnessOutput, expected, { requireMinimum: 5 }), {
    compared: 6,
    bad: [],
    ok: true,
  });
});

Deno.test("CRLF harness output parses the same as LF", () => {
  const crlf = compareHarnessOutput(harnessOutput.replaceAll("\n", "\r\n"), expected, {
    requireMinimum: 5,
  });
  assertEquals(crlf, compareHarnessOutput(harnessOutput, expected, { requireMinimum: 5 }));
  assertEquals(crlf.compared, 6, "the Windows C runtime's \\r once left nothing matching");
});

Deno.test("a size and an offset mismatch are reported in the check's words", () => {
  const output = [
    "SteamIPAddress_t size=24",
    "  SteamIPAddress_t.m_eType off=17",
  ].join("\n");
  assertEquals(compareHarnessOutput(output, expected), {
    compared: 2,
    bad: [
      "SteamIPAddress_t size 20 computed, 24 real",
      "SteamIPAddress_t.m_eType offset 16 computed, 17 real",
    ],
    ok: false,
  });
});

Deno.test("a struct or field the table does not carry is a mismatch, not a skip", () => {
  const output = [
    "NewInSDK_t size=8",
    "  SteamIPAddress_t.m_newField off=20",
  ].join("\n");
  assertEquals(compareHarnessOutput(output, expected).bad, [
    "NewInSDK_t size undefined computed, 8 real",
    "SteamIPAddress_t.m_newField offset undefined computed, 20 real",
  ]);
});

Deno.test("log noise and near-miss lines are not comparisons", () => {
  const output = [
    "[S_API] SteamAPI_Init(): loaded 'libsteam_api.dylib'",
    "",
    "S_API: SteamClient() failed.",
    "ld: warning: ignoring file libsteamclient.dylib",
    "SteamIPAddress_t size=20 extra",
    "SteamIPAddress_t.m_eType off=16",
    "   ",
    "  SteamIPAddress_t.m_eType off=16",
  ].join("\n");
  assertEquals(compareHarnessOutput(output, expected), { compared: 1, bad: [], ok: false });
});

Deno.test("output that compares too little fails the minimum-count guard", () => {
  assertEquals(compareHarnessOutput("", expected), { compared: 0, bad: [], ok: false });
  assertEquals(compareHarnessOutput("the harness never ran\n", expected), {
    compared: 0,
    bad: [],
    ok: false,
  });
  assertEquals(compareHarnessOutput(harnessOutput, expected, { requireMinimum: 6 }).ok, false);
  assertEquals(compareHarnessOutput(harnessOutput, expected, { requireMinimum: 5 }).ok, true);
});
