import { assertEquals } from "@std/assert";
import { effectivePack, scanPacking } from "./packscan.ts";

const header = (text: string) => [{ name: "t.h", text }];

Deno.test("a struct outside any region uses natural alignment", () => {
  const m = scanPacking(header("struct Loose_t\n{\n int a;\n};\n"));
  assertEquals(m.get("Loose_t"), "natural");
  assertEquals(effectivePack(m.get("Loose_t"), 4), 8);
});

Deno.test("a fixed push applies its own value", () => {
  const m = scanPacking(
    header("#pragma pack( push, 1 )\nstruct Tight_t\n{\n};\n#pragma pack( pop )\n"),
  );
  assertEquals(m.get("Tight_t"), 1);
  assertEquals(effectivePack(m.get("Tight_t"), 8), 1);
});

Deno.test("a push guarded by VALVE_CALLBACK_PACK is platform dependent", () => {
  const text = [
    "#if defined( VALVE_CALLBACK_PACK_SMALL )",
    "#pragma pack( push, 4 )",
    "#elif defined( VALVE_CALLBACK_PACK_LARGE )",
    "#pragma pack( push, 8 )",
    "#endif",
    "struct Callback_t",
    "{",
    "};",
    "#pragma pack( pop )",
  ].join("\n");
  const m = scanPacking(header(text));
  assertEquals(m.get("Callback_t"), "platform");
  assertEquals(effectivePack(m.get("Callback_t"), 4), 4);
  assertEquals(effectivePack(m.get("Callback_t"), 8), 8);
});

Deno.test("packing returns to the outer region after a pop", () => {
  const text = [
    "#pragma pack( push, 1 )",
    "struct Inner_t {};",
    "#pragma pack( pop )",
    "struct After_t {};",
  ].join("\n");
  const m = scanPacking(header(text));
  assertEquals(m.get("Inner_t"), 1);
  assertEquals(m.get("After_t"), "natural");
});

Deno.test("an #if/#elif chain contributes one push, so later structs are outside it", () => {
  // The shape steamnetworkingtypes.h uses: a guarded push, a nested fixed push, then two pops.
  const text = [
    "#if defined( VALVE_CALLBACK_PACK_SMALL )",
    "#pragma pack( push, 4 )",
    "#elif defined( VALVE_CALLBACK_PACK_LARGE )",
    "#pragma pack( push, 8 )",
    "#else",
    "#error nope",
    "#endif",
    "struct Guarded_t {};",
    "#pragma pack(push,1)",
    "struct Tight_t {};",
    "#pragma pack(pop)",
    "struct StillGuarded_t {};",
    "#pragma pack( pop )",
    "struct Outside_t {};",
  ].join("\n");
  const m = scanPacking(header(text));
  assertEquals(m.get("Guarded_t"), "platform");
  assertEquals(m.get("Tight_t"), 1);
  assertEquals(m.get("StillGuarded_t"), "platform");
  assertEquals(m.get("Outside_t"), "natural");
});

Deno.test("callback structs declared through Valve's macros are seen", () => {
  const text = [
    "#pragma pack( push, 4 )",
    "STEAM_CALLBACK_BEGIN( HTML_NeedsPaint_t, k_iSteamHTMLSurfaceCallbacks + 2 )",
    "STEAM_CALLBACK_MEMBER( 0, HHTMLBrowser, unBrowserHandle )",
    "STEAM_CALLBACK_END(1)",
    "#pragma pack( pop )",
  ].join("\n");
  assertEquals(scanPacking(header(text)).get("HTML_NeedsPaint_t"), 4);
});
