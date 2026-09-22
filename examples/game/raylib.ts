/**
 * The slice of raylib this demo needs, bound through Deno FFI.
 *
 * This is deliberately small and hand-written: the point of the demo is that a second
 * native library coexists with the Steam one in a single process, and in a single binary
 * built with `deno compile`.
 */
import { fromFileUrl } from "@std/path";

/** raylib's `Color`, four bytes passed by value. */
export type Color = readonly [r: number, g: number, b: number, a: number];

export const WHITE: Color = [255, 255, 255, 255];
export const BLACK: Color = [0, 0, 0, 255];
export const DARKBLUE: Color = [0, 82, 172, 255];
export const RAYWHITE: Color = [245, 245, 245, 255];
export const LIGHTGRAY: Color = [200, 200, 200, 255];
export const GREEN: Color = [0, 228, 48, 255];
export const GOLD: Color = [255, 203, 0, 255];
export const MAROON: Color = [190, 33, 55, 255];

/** The key codes this demo reads, from raylib's `KeyboardKey`. */
export const KEY = {
  UP: 265,
  DOWN: 264,
  W: 87,
  S: 83,
  SPACE: 32,
  ESCAPE: 256,
} as const;

const COLOR = { struct: ["u8", "u8", "u8", "u8"] } as const;

const SYMBOLS = {
  InitWindow: { parameters: ["i32", "i32", "buffer"], result: "void" },
  CloseWindow: { parameters: [], result: "void" },
  WindowShouldClose: { parameters: [], result: "bool" },
  SetTargetFPS: { parameters: ["i32"], result: "void" },
  SetTraceLogLevel: { parameters: ["i32"], result: "void" },
  BeginDrawing: { parameters: [], result: "void" },
  EndDrawing: { parameters: [], result: "void" },
  ClearBackground: { parameters: [COLOR], result: "void" },
  DrawText: { parameters: ["buffer", "i32", "i32", "i32", COLOR], result: "void" },
  DrawRectangle: { parameters: ["i32", "i32", "i32", "i32", COLOR], result: "void" },
  DrawCircle: { parameters: ["i32", "i32", "f32", COLOR], result: "void" },
  IsKeyDown: { parameters: ["i32"], result: "bool" },
  GetFrameTime: { parameters: [], result: "f32" },
} as const satisfies Deno.ForeignLibraryInterface;

/**
 * Every place raylib might be, most specific first.
 *
 * A file embedded by `deno compile --include` can be opened but not inspected: it lives in
 * the binary's virtual file system, so `Deno.statSync` reports it missing while
 * `Deno.dlopen` loads it. Checking before opening therefore rejects exactly the case that
 * matters, which is why the caller tries each path in turn instead.
 */
export function raylibCandidates(moduleUrl?: string): string[] {
  const explicit = Deno.env.get("RAYLIB_PATH");
  if (explicit) return [explicit];
  const paths: string[] = [];
  // Beside the caller's module, which is where deno compile unpacks an included file.
  if (moduleUrl) paths.push(fromFileUrl(new URL(libraryFileName(), moduleUrl)));
  paths.push(...usualLocations());
  return paths;
}

/** The first candidate that exists on disk, for callers that only want a path. */
export function resolveRaylibPath(moduleUrl?: string): string {
  for (const candidate of raylibCandidates(moduleUrl)) {
    try {
      Deno.statSync(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error(
    `Cannot find raylib. Install it (brew install raylib, apt install libraylib-dev) or set ` +
      `RAYLIB_PATH to ${libraryFileName()}.`,
  );
}

function libraryFileName(): string {
  if (Deno.build.os === "darwin") return "libraylib.dylib";
  if (Deno.build.os === "windows") return "raylib.dll";
  return "libraylib.so";
}

function usualLocations(): string[] {
  if (Deno.build.os === "darwin") {
    return ["/opt/homebrew/lib/libraylib.dylib", "/usr/local/lib/libraylib.dylib"];
  }
  if (Deno.build.os === "windows") return ["raylib.dll", "C:\\raylib\\lib\\raylib.dll"];
  return [
    "/usr/lib/libraylib.so",
    "/usr/local/lib/libraylib.so",
    "/usr/lib/x86_64-linux-gnu/libraylib.so",
  ];
}

const encoder = new TextEncoder();
const cstr = (s: string) => encoder.encode(`${s}\0`);
const color = (c: Color) => new Uint8Array(c);

/** raylib, opened once. */
export class Raylib {
  readonly #lib: Deno.DynamicLibrary<typeof SYMBOLS>;

  private constructor(lib: Deno.DynamicLibrary<typeof SYMBOLS>) {
    this.#lib = lib;
  }

  /** Open raylib from an explicit path. */
  static open(path: string): Raylib {
    return new Raylib(Deno.dlopen(path, SYMBOLS));
  }

  /**
   * Try each candidate in turn and keep the first that opens.
   *
   * Opening is the only reliable test: a library embedded by `deno compile` cannot be
   * stat'ed, so anything that checks the file first misses it.
   */
  static openFirstAvailable(moduleUrl?: string): Raylib {
    const candidates = raylibCandidates(moduleUrl);
    const failures: string[] = [];
    for (const path of candidates) {
      try {
        return Raylib.open(path);
      } catch (e) {
        failures.push(`  ${path}: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    throw new Error(`Cannot open raylib. Tried:\n${failures.join("\n")}`);
  }

  initWindow(width: number, height: number, title: string): void {
    // Quieten raylib's startup banner: 4 is LOG_WARNING.
    this.#lib.symbols.SetTraceLogLevel(4);
    this.#lib.symbols.InitWindow(width, height, cstr(title));
  }

  closeWindow(): void {
    this.#lib.symbols.CloseWindow();
  }

  close(): void {
    this.#lib.close();
  }

  shouldClose(): boolean {
    return this.#lib.symbols.WindowShouldClose();
  }

  setTargetFps(fps: number): void {
    this.#lib.symbols.SetTargetFPS(fps);
  }

  beginDrawing(): void {
    this.#lib.symbols.BeginDrawing();
  }

  endDrawing(): void {
    this.#lib.symbols.EndDrawing();
  }

  clearBackground(c: Color): void {
    this.#lib.symbols.ClearBackground(color(c));
  }

  drawText(text: string, x: number, y: number, size: number, c: Color): void {
    this.#lib.symbols.DrawText(cstr(text), x, y, size, color(c));
  }

  drawRectangle(x: number, y: number, w: number, h: number, c: Color): void {
    this.#lib.symbols.DrawRectangle(x, y, w, h, color(c));
  }

  drawCircle(x: number, y: number, radius: number, c: Color): void {
    this.#lib.symbols.DrawCircle(x, y, radius, color(c));
  }

  isKeyDown(key: number): boolean {
    return this.#lib.symbols.IsKeyDown(key);
  }

  frameTime(): number {
    return this.#lib.symbols.GetFrameTime();
  }
}
