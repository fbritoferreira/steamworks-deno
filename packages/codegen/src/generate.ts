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

export interface GenerateOptions {
  /** Root of an unzipped Steamworks SDK: the folder holding `public/` and `redistributable_bin/`. */
  sdkPath: string;
  /** Directory to write the generated files into. */
  outDir: string;
  /** Used when the SDK's Readme.txt does not state a version. */
  sdkVersion?: string;
}

async function detectVersion(sdkPath: string, fallback: string): Promise<string> {
  try {
    const readme = await Deno.readTextFile(join(sdkPath, "Readme.txt"));
    return /v(\d+\.\d+)/.exec(readme)?.[1] ?? fallback;
  } catch {
    return fallback;
  }
}

/** Generate every binding file. Returns the paths written, sorted. */
export async function generate(opts: GenerateOptions): Promise<string[]> {
  const schema = await loadSchema(join(opts.sdkPath, "public", "steam", "steam_api.json"));
  const version = await detectVersion(opts.sdkPath, opts.sdkVersion ?? "unknown");
  const ctx = buildContext(schema);
  const resolver = new LayoutResolver(schema, ctx);
  const h = header(version);

  const files = new Map<string, string>();
  files.set("enums.ts", h + emitEnums(schema));
  files.set("consts.ts", h + emitConsts(schema, ctx));
  files.set("structs.ts", h + emitStructs(schema, ctx, resolver));
  files.set("callback_ids.ts", h + emitCallbackIds(schema));
  files.set("layout.json", emitLayoutJson(schema, resolver));
  files.set("layout_check.cpp", emitHarnessC(schema));

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
