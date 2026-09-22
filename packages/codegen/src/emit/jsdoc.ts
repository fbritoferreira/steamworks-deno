/** Renders a JSDoc block from documentation harvested out of the SDK headers. */

/** Escape a comment terminator so the generated file still parses. */
function safe(text: string): string {
  return text.replaceAll("*/", "*\\/");
}

/**
 * A JSDoc block for `text`, indented by `indent`. Returns an empty string when there is
 * nothing to say, so callers can concatenate unconditionally.
 */
export function jsdoc(text: string | undefined, indent = ""): string {
  if (!text) return "";
  const lines = safe(text).split("\n").map((l) => l.trimEnd());
  if (lines.length === 1) return `${indent}/** ${lines[0]} */\n`;
  return `${indent}/**\n${lines.map((l) => `${indent} * ${l}`).join("\n")}\n${indent} */\n`;
}
