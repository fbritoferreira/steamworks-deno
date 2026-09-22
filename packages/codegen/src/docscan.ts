/**
 * Harvests documentation from the SDK headers.
 *
 * `steam_api.json` carries almost none: zero method descriptions across 921 methods. The
 * headers document roughly 63 percent of them, so that is the only source of text worth
 * putting on the generated bindings.
 *
 * Comments are taken verbatim. Some are group headers rather than per-method prose, such
 * as `Data accessors` above the first of a run, because that is what sits directly above
 * the declaration.
 */

/** Documentation harvested from the SDK headers, keyed for lookup while emitting. */
export interface DocIndex {
  /** Keyed `ISteamUserStats.GetAchievement`. */
  methods: Map<string, string>;
  /** Keyed by struct name. */
  structs: Map<string, string>;
  /** Keyed `UserStatsStored_t.m_eResult`. */
  fields: Map<string, string>;
  /** Keyed by enum name. */
  enums: Map<string, string>;
}

const CLASS = /^\s*(?:class|struct)\s+(ISteam\w+)/;
const STRUCT = /^\s*(?:typedef\s+)?struct\s+(\w+)/;
const ENUM = /^\s*enum\s+(\w+)/;
const METHOD = /^\s*virtual\s+.*?\b(\w+)\s*\(/;
const MACRO_DECL = /^\s*(?:STEAM_CALLBACK_BEGIN|DEFINE_CALLBACK)\s*\(\s*(\w+)/;
const FIELD = /^\s*[\w:*&<>\s]+?\b(\w+)\s*(?:\[\s*\w+\s*\])?\s*;\s*\/\/\s*(.+)$/;
const STEAM_MACRO = /^\s*STEAM_\w+\s*\(/;
/** A line of only dashes, equals signs or slashes: a banner, not prose. */
const BANNER = /^[-=/\s]*$/;

function cleanComment(raw: string[]): string {
  const lines = raw
    .map((l) => l.replace(/^\/+/, "").trim())
    .filter((l) => l.length > 0 && !BANNER.test(l));
  return lines.join("\n");
}

/** Walk upwards from `idx` collecting the comment block that documents that line. */
function commentAbove(lines: string[], idx: number): string {
  const collected: string[] = [];
  let j = idx - 1;
  // Step over Steamworks annotation macros that sit between the comment and the method.
  while (j >= 0 && STEAM_MACRO.test(lines[j])) j--;
  while (j >= 0 && lines[j].trim().startsWith("//")) {
    collected.unshift(lines[j].trim());
    j--;
  }
  return cleanComment(collected);
}

/** Index every comment that documents a method, struct, field or enum. */
export function scanDocs(headers: { name: string; text: string }[]): DocIndex {
  const index: DocIndex = {
    methods: new Map(),
    structs: new Map(),
    fields: new Map(),
    enums: new Map(),
  };

  for (const { text } of headers) {
    // The headers are CRLF. JavaScript's `.` does not match a carriage return, so a
    // trailing one stops every regex that anchors on the end of the line.
    const lines = text.split(/\r?\n/);
    let currentClass: string | undefined;
    let currentStruct: string | undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const cls = CLASS.exec(line);
      if (cls) {
        currentClass = cls[1];
        currentStruct = undefined;
        continue;
      }

      const macro = MACRO_DECL.exec(line);
      if (macro) {
        currentStruct = macro[1];
        currentClass = undefined;
        const doc = commentAbove(lines, i);
        if (doc) index.structs.set(currentStruct, doc);
        continue;
      }

      const struct = STRUCT.exec(line);
      if (struct && !line.includes(";")) {
        currentStruct = struct[1];
        currentClass = undefined;
        const doc = commentAbove(lines, i);
        if (doc) index.structs.set(currentStruct, doc);
        continue;
      }

      const enumName = ENUM.exec(line);
      if (enumName) {
        const doc = commentAbove(lines, i);
        if (doc) index.enums.set(enumName[1], doc);
        continue;
      }

      if (currentClass) {
        const method = METHOD.exec(line);
        if (method) {
          const doc = commentAbove(lines, i);
          if (doc) index.methods.set(`${currentClass}.${method[1]}`, doc);
          continue;
        }
      }

      if (currentStruct) {
        const field = FIELD.exec(line);
        if (field) {
          const doc = cleanComment([field[2]]);
          if (doc) index.fields.set(`${currentStruct}.${field[1]}`, doc);
        }
      }
    }
  }

  return index;
}
