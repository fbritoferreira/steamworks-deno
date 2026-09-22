import type { SteamApiJson } from "../schema.ts";

/**
 * A single symbol table holding every interface's symbols.
 *
 * The library must be opened exactly once. Inside a binary built with `deno compile`,
 * each `Deno.dlopen` of an embedded library extracts its own copy, so a second call
 * returns an instance where `SteamAPI_InitFlat` has never run and every interface
 * accessor answers null. Opening once with all symbols avoids that entirely.
 */
export function emitAllSymbols(schema: SteamApiJson): string {
  const names = schema.interfaces.map((i) => i.classname).sort();
  const imports = names.map((n) => `  ${n}_symbols,`).join("\n");
  const spreads = names.map((n) => `  ...${n}_symbols,`).join("\n");
  return `import {\n${imports}\n} from "./mod.ts";\n\n` +
    `/**\n * Every Steamworks symbol this package binds, in one table.\n *\n` +
    ` * Open the library once with this. A second \`Deno.dlopen\` of the same path gives a\n` +
    ` * separate, uninitialised instance inside a compiled binary.\n */\n` +
    `export const ALL_INTERFACE_SYMBOLS = {\n${spreads}\n} as const satisfies Deno.ForeignLibraryInterface;\n`;
}
