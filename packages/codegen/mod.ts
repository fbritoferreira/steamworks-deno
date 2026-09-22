/**
 * Generates Deno FFI bindings for the Steamworks SDK from Valve's `steam_api.json`.
 *
 * Not affiliated with or endorsed by Valve Corporation.
 *
 * @module
 */
export * from "./src/schema.ts";
export { generate, type GenerateOptions } from "./src/generate.ts";
