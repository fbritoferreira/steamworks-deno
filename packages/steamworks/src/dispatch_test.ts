import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { Dispatcher } from "./dispatch.ts";

Deno.test("on/emit delivers to listeners and unsubscribe works", () => {
  const d = new Dispatcher();
  const seen: number[] = [];
  const off = d.on(1103, (b) => seen.push(b.length));
  assertEquals(d.emit(1103, new Uint8Array(3)), 1);
  off();
  assertEquals(d.emit(1103, new Uint8Array(3)), 0);
  assertEquals(seen, [3]);
});

Deno.test("waitFor resolves via takePending", async () => {
  const d = new Dispatcher();
  const p = d.waitFor(42n, 1110);
  assertEquals(d.pendingCount, 1);
  const pending = d.takePending(42n)!;
  assertEquals(pending.callbackId, 1110);
  pending.resolve(new Uint8Array([7]));
  assertEquals(await p, new Uint8Array([7]));
  assertEquals(d.pendingCount, 0);
});

Deno.test("waitFor rejects invalid handle", async () => {
  const d = new Dispatcher();
  await assertRejects(() => d.waitFor(0n, 1110), Error, "invalid");
});

Deno.test("rejectAll rejects outstanding", async () => {
  const d = new Dispatcher();
  const p = d.waitFor(1n, 1);
  d.rejectAll(new Error("bye"));
  await assertRejects(() => p, Error, "bye");
});
