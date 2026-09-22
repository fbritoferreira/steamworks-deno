import { assertEquals } from "@std/assert";
import { scanDocs } from "./docscan.ts";

const header = (text: string) => [{ name: "isteamtest.h", text }];

Deno.test("a comment directly above a method documents it", () => {
  const docs = scanDocs(header([
    "class ISteamTest",
    "{",
    "public:",
    "\t// Returns the number of things.",
    "\tvirtual int GetThingCount() = 0;",
    "};",
  ].join("\n")));
  assertEquals(docs.methods.get("ISteamTest.GetThingCount"), "Returns the number of things.");
});

Deno.test("a multi-line comment is joined", () => {
  const docs = scanDocs(header([
    "class ISteamTest",
    "{",
    "\t// First line.",
    "\t// Second line.",
    "\tvirtual bool DoThing() = 0;",
    "};",
  ].join("\n")));
  assertEquals(docs.methods.get("ISteamTest.DoThing"), "First line.\nSecond line.");
});

Deno.test("an annotation macro between comment and method is stepped over", () => {
  const docs = scanDocs(header([
    "class ISteamTest",
    "{",
    "\t// Downloads a file.",
    "\tSTEAM_CALL_RESULT( RemoteStorageDownload_t )",
    "\tvirtual SteamAPICall_t Download() = 0;",
    "};",
  ].join("\n")));
  assertEquals(docs.methods.get("ISteamTest.Download"), "Downloads a file.");
});

Deno.test("banner lines are dropped but their prose is kept", () => {
  const docs = scanDocs(header([
    "class ISteamTest",
    "{",
    "\t//-----------------------------------------------",
    "\t// Purpose: does a thing",
    "\t//-----------------------------------------------",
    "\tvirtual void Act() = 0;",
    "};",
  ].join("\n")));
  assertEquals(docs.methods.get("ISteamTest.Act"), "Purpose: does a thing");
});

Deno.test("a blank line breaks the association", () => {
  const docs = scanDocs(header([
    "class ISteamTest",
    "{",
    "\t// Unrelated note.",
    "",
    "\tvirtual void Act() = 0;",
    "};",
  ].join("\n")));
  assertEquals(docs.methods.get("ISteamTest.Act"), undefined);
});

Deno.test("struct and trailing field comments are collected", () => {
  const docs = scanDocs(header([
    "// A result.",
    "struct Result_t",
    "{",
    "\tint m_eResult; // the outcome",
    "};",
  ].join("\n")));
  assertEquals(docs.structs.get("Result_t"), "A result.");
  assertEquals(docs.fields.get("Result_t.m_eResult"), "the outcome");
});

Deno.test("a callback struct declared through a macro is documented", () => {
  const docs = scanDocs(header([
    "// The browser needs painting.",
    "STEAM_CALLBACK_BEGIN( HTML_NeedsPaint_t, k_iSteamHTMLSurfaceCallbacks + 2 )",
    "STEAM_CALLBACK_END(1)",
  ].join("\n")));
  assertEquals(docs.structs.get("HTML_NeedsPaint_t"), "The browser needs painting.");
});
