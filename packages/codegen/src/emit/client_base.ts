import type { Interface, SteamApiJson } from "../schema.ts";

/**
 * Property name for an interface: drop the `ISteam` prefix, then lower the leading run of
 * capitals. `ISteamUser` becomes `user`, `ISteamUGC` becomes `ugc`, and
 * `ISteamHTMLSurface` becomes `htmlSurface`, keeping the last capital with the word it
 * starts.
 */
export function getterName(classname: string): string {
  const bare = classname.replace(/^ISteam/, "");
  const lead = /^[A-Z]+/.exec(bare)?.[0] ?? "";
  if (lead.length <= 1) return bare.charAt(0).toLowerCase() + bare.slice(1);
  if (lead.length === bare.length) return bare.toLowerCase();
  return lead.slice(0, -1).toLowerCase() + bare.slice(lead.length - 1);
}

/**
 * Interfaces a game client can obtain: those Steam hands out through a user or global
 * accessor. Interfaces with none are either obtained differently, such as `ISteamClient`,
 * or implemented by the caller rather than received, such as the matchmaking responses.
 */
export function reachableInterfaces(schema: SteamApiJson): Interface[] {
  return schema.interfaces.filter((i) =>
    (i.accessors ?? []).some((a) => a.kind === "user" || a.kind === "global")
  );
}

/** One getter per reachable interface, for `SteamClient` to extend. */
export function emitClientBase(schema: SteamApiJson): string {
  const list = reachableInterfaces(schema);
  const sorted = [...list].sort((a, b) => a.classname.localeCompare(b.classname));

  let out = `import {\n${
    sorted.map((i) => `  ${i.classname},\n  ${i.classname}_symbols,`).join("\n")
  }\n} from "./mod.ts";\n\n`;

  out += `/**\n` +
    ` * One getter per Steam interface a client can obtain.\n *\n` +
    ` * \`SteamClient\` extends this and supplies \`iface\`, which reads the accessor from the\n` +
    ` * single open library and wraps the pointer once.\n */\n`;
  out += `export abstract class SteamInterfaces {\n`;
  out += `  protected abstract iface<S extends Deno.ForeignLibraryInterface, T>(\n` +
    `    name: string,\n` +
    `    symbols: S,\n` +
    `    accessor: string,\n` +
    `    make: (s: Deno.DynamicLibrary<S>["symbols"], self: Deno.PointerValue, host: never) => T,\n` +
    `  ): T;\n`;

  for (const i of sorted) {
    const n = i.classname;
    out += `\n  get ${getterName(n)}(): ${n} {\n` +
      `    return this.iface(\n` +
      `      "${n}",\n      ${n}_symbols,\n      ${n}.accessor,\n` +
      `      (s, p, h) => new ${n}(s, p, h as never),\n` +
      `    );\n  }\n`;
  }
  out += `}\n`;
  return out;
}
