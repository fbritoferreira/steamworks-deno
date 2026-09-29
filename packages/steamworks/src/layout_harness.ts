/**
 * The comparison at the heart of the layout check: the C++ harness's output against the
 * generated layout table for this platform's packing.
 *
 * The harness prints one `Name size=N` line per struct and one `  Name.field off=N` line per
 * field, every value taken from the machine's own compiler. It used to live inline in
 * `verify.ts`, where no test could reach it — which is how the Windows CRLF bug shipped:
 * every line of the harness output ended in a carriage return, no regex matched, and zero
 * comparisons read as agreement.
 */

/** One struct as `gen/layout.json` records it: its size, and where each field sits. */
export interface ExpectedLayout {
  /** The struct's size in bytes. */
  size: number;
  /** Each field's offset, in bytes from the start of the struct. */
  fields: Record<string, number>;
}

/** What comparing one run of harness output with the expected table found. */
export interface HarnessComparison {
  /** Sizes and offsets the output carried, agreed or not; noise lines count for nothing. */
  compared: number;
  /** Every mismatch, phrased exactly as the verify check prints it. */
  bad: string[];
  /** False when anything disagreed, or when the output said too little to trust agreement. */
  ok: boolean;
}

/**
 * Compare the layout harness's output with the expected layout table.
 *
 * A line naming a size or an offset is compared against the table's entry for that struct;
 * anything else — blank lines, log noise — is ignored. Carriage returns are stripped first,
 * so CRLF output from the Windows C runtime parses exactly like LF: the first Windows run of
 * the harness compared zero offsets because nothing stripped them.
 *
 * `ok` demands more than an empty `bad`: the output must also carry more comparisons than
 * `requireMinimum`, so a run whose output parses as almost nothing fails instead of agreeing
 * vacuously — the guard that caught the CRLF run reading as "0 sizes and offsets agree".
 *
 * @param text The harness's stdout, LF or CRLF.
 * @param expected `gen/layout.json`'s table for one packing, keyed by struct name.
 * @param opts.requireMinimum The comparison count the output must exceed for agreement to
 * count. Defaults to 500, the verify check's floor.
 * @returns The counts, the mismatches in the check's words, and the verdict.
 */
export function compareHarnessOutput(
  text: string,
  expected: Record<string, ExpectedLayout>,
  opts: { requireMinimum?: number } = {},
): HarnessComparison {
  const minimum = opts.requireMinimum ?? 500;
  let compared = 0;
  const bad: string[] = [];
  for (const line of text.replaceAll("\r", "").split("\n")) {
    const size = /^(\w+) size=(\d+)$/.exec(line);
    if (size) {
      compared++;
      if (expected[size[1]]?.size !== Number(size[2])) {
        bad.push(`${size[1]} size ${expected[size[1]]?.size} computed, ${size[2]} real`);
      }
      continue;
    }
    const off = /^\s+(\w+)\.(\w+) off=(\d+)$/.exec(line);
    if (off) {
      compared++;
      if (expected[off[1]]?.fields[off[2]] !== Number(off[3])) {
        bad.push(
          `${off[1]}.${off[2]} offset ${expected[off[1]]?.fields[off[2]]} computed, ${off[3]} real`,
        );
      }
    }
  }
  return { compared, bad, ok: bad.length === 0 && compared > minimum };
}
