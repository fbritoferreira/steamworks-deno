/** Reads a Steamworks SDK and writes the whole generated binding set. */
import { join } from "@std/path";
import { loadSchema } from "./schema.ts";
import { buildContext } from "./types.ts";
import { LayoutResolver } from "./layout.ts";
import { header } from "./emit/header.ts";
import { emitEnums } from "./emit/enums.ts";
import { emitConsts } from "./emit/consts.ts";
import { emitStructs } from "./emit/structs.ts";
import { emitCallbackIds } from "./emit/callback_ids.ts";
import { emitLayoutJson } from "./emit/layout_json.ts";
import { emitInterface } from "./emit/interface.ts";
import { emitHarnessC } from "./emit/harness_c.ts";
import { emitAllSymbols } from "./emit/all_symbols.ts";
import { emitClientBase } from "./emit/client_base.ts";
import { scanPacking } from "./packscan.ts";

export interface GenerateOptions {
  /** Root of an unzipped Steamworks SDK: the folder holding `public/` and `redistributable_bin/`. */
  sdkPath: string;
  /** Directory to write the generated files into. */
  outDir: string;
  /** Overrides the version read from the SDK's Readme.txt. */
  sdkVersion?: string;
}

/** Read every SDK header, so the packing scanner can see each struct's pragma context. */
async function readHeaders(dir: string): Promise<{ name: string; text: string }[]> {
  const out: { name: string; text: string }[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".h")) continue;
    out.push({ name: entry.name, text: await Deno.readTextFile(join(dir, entry.name)) });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Read the SDK version from `Readme.txt`, the only file that states it.
 *
 * An explicit `sdkVersion` always wins. When neither is available this throws rather than
 * guessing: the version is baked into every generated file and into the error a version
 * mismatch reports, so a wrong value is worse than a refusal.
 */
async function detectVersion(sdkPath: string, explicit?: string): Promise<string> {
  if (explicit) return explicit;
  let readme: string;
  try {
    readme = await Deno.readTextFile(join(sdkPath, "Readme.txt"));
  } catch {
    throw new Error(
      `Cannot determine the SDK version: ${join(sdkPath, "Readme.txt")} is missing. ` +
        `Copy it from the SDK zip, or pass the version explicitly ` +
        `(STEAMWORKS_SDK_VERSION when using the command line).`,
    );
  }
  const found = /v(\d+\.\d+)/.exec(readme)?.[1];
  if (!found) {
    throw new Error(
      `Cannot determine the SDK version: no "vN.N" found in ${join(sdkPath, "Readme.txt")}.`,
    );
  }
  return found;
}

/** Generate every binding file. Returns the paths written, sorted. */
export async function generate(opts: GenerateOptions): Promise<string[]> {
  const schema = await loadSchema(join(opts.sdkPath, "public", "steam", "steam_api.json"));
  const version = await detectVersion(opts.sdkPath, opts.sdkVersion);
  const ctx = buildContext(schema);
  const packing = scanPacking(await readHeaders(join(opts.sdkPath, "public", "steam")));
  const resolver = new LayoutResolver(schema, ctx, packing);
  const h = header(version);

  const files = new Map<string, string>();
  files.set("enums.ts", h + emitEnums(schema));
  files.set("consts.ts", h + emitConsts(schema, ctx));
  files.set("structs.ts", h + emitStructs(schema, ctx, resolver));
  files.set("callback_ids.ts", h + emitCallbackIds(schema));
  files.set("layout.json", emitLayoutJson(schema, resolver));
  files.set("layout_check.cpp", emitHarnessC(schema));
  files.set("all_symbols.ts", h + emitAllSymbols(schema));
  files.set("client_base.ts", h + emitClientBase(schema));

  const names: string[] = [];
  for (const i of schema.interfaces) {
    files.set(join("interfaces", `${i.classname}.ts`), h + emitInterface(i, ctx, resolver));
    names.push(i.classname);
  }
  names.sort();

  files.set(
    "mod.ts",
    h + `export const SDK_VERSION = "${version}";\n\n` +
      `export * from "./enums.ts";\n` +
      `export * from "./consts.ts";\n` +
      `export * from "./structs.ts";\n` +
      `export * from "./callback_ids.ts";\n` +
      names.map((n) => `export * from "./interfaces/${n}.ts";`).join("\n") + "\n",
  );

  await Deno.mkdir(join(opts.outDir, "interfaces"), { recursive: true });
  const written: string[] = [];
  for (const [rel, content] of files) {
    const path = join(opts.outDir, rel);
    await Deno.writeTextFile(path, content);
    written.push(path);
  }

  const tsAndJson = written.filter((p) => p.endsWith(".ts") || p.endsWith(".json"));
  const fmt = await new Deno.Command(Deno.execPath(), {
    args: ["fmt", ...tsAndJson],
    stderr: "piped",
    stdout: "null",
  }).output();
  if (!fmt.success) {
    throw new Error(
      `deno fmt failed on generated output:\n${new TextDecoder().decode(fmt.stderr)}`,
    );
  }
  return written.sort();
}
