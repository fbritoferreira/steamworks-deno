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
export function emitClientBase(
  schema: SteamApiJson,
  opts: {
    className?: string;
    select?: (s: SteamApiJson) => Interface[];
    /**
     * Which accessor to prefer when an interface has more than one. ISteamHTTP is reached
     * through `SteamAPI_SteamHTTP_v003` by a client and `SteamAPI_SteamGameServerHTTP_v003`
     * by a server; using the wrong one returns a null pointer.
     */
    accessorKinds?: readonly ("user" | "global" | "gameserver")[];
  } = {},
): string {
  const className = opts.className ?? "SteamInterfaces";
  const kinds = opts.accessorKinds ?? ["user", "global"];
  const list = (opts.select ?? reachableInterfaces)(schema);
  const sorted = [...list].sort((a, b) => a.classname.localeCompare(b.classname));
  const accessorFor = (i: Interface): string | undefined => {
    for (const kind of kinds) {
      const found = (i.accessors ?? []).find((a) => a.kind === kind);
      if (found) return found.name_flat;
    }
    return (i.accessors ?? [])[0]?.name_flat;
  };

  let out = `import {\n${
    sorted.map((i) => `  ${i.classname},\n  ${i.classname}_symbols,`).join("\n")
  }\n} from "./mod.ts";\n\n`;

  out += `/**\n` +
    ` * One getter per Steam interface a client can obtain.\n *\n` +
    ` * The client extends this and supplies \`iface\`, which reads the accessor from the\n` +
    ` * single open library and wraps the pointer once.\n */\n`;
  out += `export abstract class ${className} {\n`;
  out += `  protected abstract iface<S extends Deno.ForeignLibraryInterface, T>(\n` +
    `    name: string,\n` +
    `    symbols: S,\n` +
    `    accessor: string,\n` +
    `    make: (s: Deno.DynamicLibrary<S>["symbols"], self: Deno.PointerValue, host: never) => T,\n` +
    `  ): T;\n`;

  for (const i of sorted) {
    const n = i.classname;
    const accessor = accessorFor(i);
    if (!accessor) continue;
    out += `\n  get ${getterName(n)}(): ${n} {\n` +
      `    return this.iface(\n` +
      `      "${n}",\n      ${n}_symbols,\n      "${accessor}",\n` +
      `      (s, p, h) => new ${n}(s, p, h as never),\n` +
      `    );\n  }\n`;
  }
  out += `}\n`;
  return out;
}

/** Interfaces a dedicated game server can obtain. */
export function gameServerInterfaces(schema: SteamApiJson): Interface[] {
  return schema.interfaces.filter((i) => (i.accessors ?? []).some((a) => a.kind === "gameserver"));
}

/**
 * The interface versions `SteamInternal_GameServer_Init_V2` checks.
 *
 * Steam refuses to start when one does not match what the library implements, which is how
 * an SDK mismatch surfaces at init rather than at the first call. The order follows the
 * SDK header, and the values come from the schema rather than being written out by hand.
 */
export function emitGameServerVersions(schema: SteamApiJson): string {
  const wanted = [
    "ISteamUtils",
    "ISteamNetworkingUtils",
    "ISteamGameServer",
    "ISteamGameServerStats",
    "ISteamHTTP",
    "ISteamInventory",
    "ISteamNetworking",
    "ISteamNetworkingMessages",
    "ISteamNetworkingSockets",
    "ISteamUGC",
  ];
  const versions: string[] = [];
  for (const name of wanted) {
    const iface = schema.interfaces.find((i) => i.classname === name);
    if (iface?.version_string) versions.push(iface.version_string);
  }
  const literal = versions.map((v) => `  ${JSON.stringify(v)},`).join("\n");
  return `/**\n * Interface versions the game server init checks, in the order the SDK header passes\n` +
    ` * them. They are joined with NUL separators and terminated with a second NUL.\n */\n` +
    `export const GAME_SERVER_INTERFACE_VERSIONS = [\n${literal}\n] as const;\n`;
}
