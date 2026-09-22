/**
 * Compiles the generated C++ harness against the SDK headers and compares every size and
 * offset it prints with `gen/layout.json` for this platform's packing.
 *
 * Needs STEAMWORKS_SDK_PATH and clang. Skipped when either is missing.
 */
import { assertEquals, assertGreater } from "@std/assert";
import { PACK } from "../src/layout.ts";
import { fromFileUrl } from "@std/path";

const sdk = Deno.env.get("STEAMWORKS_SDK_PATH");
const here = fromFileUrl(new URL(".", import.meta.url));

async function haveClang(): Promise<boolean> {
  try {
    const p = await new Deno.Command("clang++", {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    })
      .output();
    return p.success;
  } catch {
    return false;
  }
}

Deno.test({
  name: "the C compiler agrees with the generated layout table",
  ignore: !sdk || !(await haveClang()),
  async fn() {
    const build = `${here}.build`;
    await Deno.mkdir(build, { recursive: true });
    const exe = `${build}/layout_check${Deno.build.os === "windows" ? ".exe" : ""}`;

    const cc = await new Deno.Command("clang++", {
      args: [
        "-std=c++17",
        // Valve's headers take offsetof on types with private members on purpose.
        "-Wno-invalid-offsetof",
        `-I${sdk}/public`,
        `${here}../gen/layout_check.cpp`,
        "-o",
        exe,
      ],
      stderr: "piped",
      stdout: "null",
    }).output();
    if (!cc.success) throw new Error(new TextDecoder().decode(cc.stderr));

    const run = await new Deno.Command(exe, { stdout: "piped" }).output();
    const text = new TextDecoder().decode(run.stdout);

    const table = JSON.parse(await Deno.readTextFile(`${here}../gen/layout.json`));
    const expected = table.pack[String(PACK)] as Record<
      string,
      { size: number; fields: Record<string, number> }
    >;

    const mismatches: string[] = [];
    let checkedSizes = 0;
    let checkedOffsets = 0;

    for (const line of text.split("\n")) {
      const size = /^(\w+) size=(\d+)$/.exec(line);
      if (size) {
        const [, name, value] = size;
        checkedSizes++;
        if (expected[name]?.size !== Number(value)) {
          mismatches.push(`${name}: size ${expected[name]?.size} computed, ${value} from clang`);
        }
        continue;
      }
      const off = /^\s+(\w+)\.(\w+) off=(\d+)$/.exec(line);
      if (off) {
        const [, name, field, value] = off;
        checkedOffsets++;
        if (expected[name]?.fields[field] !== Number(value)) {
          mismatches.push(
            `${name}.${field}: offset ${
              expected[name]?.fields[field]
            } computed, ${value} from clang`,
          );
        }
      }
    }

    assertGreater(checkedSizes, 200, "the harness should report every struct");
    assertGreater(checkedOffsets, 500, "the harness should report every field");
    assertEquals(mismatches, [], `\n${mismatches.join("\n")}`);
  },
});
