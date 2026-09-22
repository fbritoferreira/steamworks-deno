/**
 * Works out the packing that applies to each struct by reading the SDK headers.
 *
 * `steam_api.json` says nothing about packing, and the headers use three regimes:
 * a platform-dependent region (`pack(4)` on macOS, Linux and FreeBSD, `pack(8)` on Windows),
 * fixed regions such as the `pack(1)` block around the Steam Input structs, and code outside
 * any region, which uses the compiler's natural alignment.
 */

/** The packing regime a struct falls under, as declared by its header. */
export type PackMode = "platform" | "natural" | 1 | 2 | 4 | 8;

const PUSH = /^\s*#pragma\s+pack\s*\(\s*push\s*,\s*(\d+)\s*\)/;
const POP = /^\s*#pragma\s+pack\s*\(\s*pop\s*\)/;
const PLATFORM_GUARD = /VALVE_CALLBACK_PACK_(SMALL|LARGE)/;
const DECL = /^\s*(?:typedef\s+)?(?:struct|class|union)\s+([A-Za-z_]\w*)\s*(?:$|[:{])/;
/** Valve declares many callback structs through macros rather than the `struct` keyword. */
const MACRO_DECL = /^\s*(?:STEAM_CALLBACK_BEGIN|DEFINE_CALLBACK)\s*\(\s*([A-Za-z_]\w*)/;

/**
 * Map every struct or class declared in `headers` to the packing in force where it appears.
 * A push whose nearest preceding conditional mentions VALVE_CALLBACK_PACK is platform
 * dependent, so it resolves to 4 or 8 at generation time.
 */
export function scanPacking(headers: { name: string; text: string }[]): Map<string, PackMode> {
  const out = new Map<string, PackMode>();
  for (const { text } of headers) {
    const stack: PackMode[] = [];
    // Only one branch of a #if/#elif chain compiles, so the chain contributes at most one
    // push even though several appear in the text.
    const chains: { guarded: boolean; pushed: boolean }[] = [];
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (/^\s*#\s*if/.test(line)) {
        chains.push({ guarded: PLATFORM_GUARD.test(line), pushed: false });
      } else if (/^\s*#\s*(elif|else)/.test(line)) {
        const top = chains[chains.length - 1];
        if (top) top.guarded = top.guarded || PLATFORM_GUARD.test(line);
      } else if (/^\s*#\s*endif/.test(line)) {
        chains.pop();
      }
      const push = PUSH.exec(line);
      if (push) {
        const chain = chains[chains.length - 1];
        if (chain) {
          if (chain.pushed) continue; // a sibling branch already pushed
          chain.pushed = true;
        }
        stack.push(chain?.guarded ? "platform" : (Number(push[1]) as 1 | 2 | 4 | 8));
        continue;
      }
      if (POP.test(line)) {
        stack.pop();
        continue;
      }
      const decl = DECL.exec(line) ?? MACRO_DECL.exec(line);
      if (decl) {
        const name = decl[1];
        const mode: PackMode = stack.length ? stack[stack.length - 1] : "natural";
        // A forward declaration can appear before the real one; the packed region wins.
        const existing = out.get(name);
        if (existing === undefined || (existing === "natural" && mode !== "natural")) {
          out.set(name, mode);
        }
      }
    }
  }
  return out;
}

/** Resolve a scanned mode to a concrete byte alignment cap for one platform packing. */
export function effectivePack(mode: PackMode | undefined, platform: 4 | 8): number {
  if (mode === undefined || mode === "natural") return 8;
  if (mode === "platform") return platform;
  return mode;
}
