const encoder = new TextEncoder();

/** Encode a JS string as a NUL-terminated UTF-8 buffer suitable for a `const char*` parameter. */
export function cstr(value: string): Uint8Array {
  const bytes = encoder.encode(value);
  const out = new Uint8Array(bytes.length + 1);
  out.set(bytes);
  return out;
}

/**
 * Copy a `const char*` returned by Steam into a JS string.
 * Steam owns the memory and it is only valid until the next API call, so copy immediately.
 */
export function readCString(ptr: Deno.PointerValue): string {
  if (ptr === null) return "";
  return new Deno.UnsafePointerView(ptr).getCString();
}

/** Read a fixed-size `char[N]` field out of a struct buffer, stopping at the first NUL. */
export function readFixedString(bytes: Uint8Array, offset: number, length: number): string {
  const slice = bytes.subarray(offset, offset + length);
  const nul = slice.indexOf(0);
  return new TextDecoder().decode(nul === -1 ? slice : slice.subarray(0, nul));
}
