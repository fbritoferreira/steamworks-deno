/**
 * Lifecycle safety: what happens around shutdown, and to a call result nobody answers.
 *
 * The crash these guard against is quiet. Calling an interface after shutdown reaches a
 * pointer into a closed library, and the process dies with SIGSEGV and no message.
 */
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { SteamClient } from "./client.ts";
import { Dispatcher } from "./dispatch.ts";

const sdk = Deno.env.get("STEAMWORKS_SDK_PATH");

Deno.test({
  name: "touching an interface after shutdown throws instead of crashing",
  ignore: !sdk,
  fn() {
    const steam = SteamClient.init({ appId: 480, sdkPath: sdk });
    steam.shutdown();
    assertThrows(() => steam.friends.getPersonaName(), Error, "has been shut down");
    assertThrows(() => steam.userStats.getNumAchievements(), Error, "has been shut down");
  },
});

Deno.test({
  name: "shutdown is idempotent and reports the client as closed",
  ignore: !sdk,
  fn() {
    const steam = SteamClient.init({ appId: 480, sdkPath: sdk });
    assertEquals(steam.isRunning, true);
    steam.shutdown();
    steam.shutdown();
    assertEquals(steam.isRunning, false);
  },
});

Deno.test({
  name: "an interface obtained before shutdown is cleared with it",
  ignore: !sdk,
  fn() {
    const steam = SteamClient.init({ appId: 480, sdkPath: sdk });
    steam.friends.getPersonaName();
    steam.shutdown();
    assertThrows(() => steam.friends.getPersonaName(), Error, "has been shut down");
  },
});

Deno.test("a call result nobody answers is rejected on its deadline", async () => {
  const d = new Dispatcher();
  const promise = d.waitFor(42n, 1101, 30);
  // The deadline timer is unreffed so a pending call never holds a process open. A game
  // always has a loop running, so keep one alive here too.
  const keepAlive = setInterval(() => {}, 5);
  try {
    await assertRejects(() => promise, Error, "did not complete");
  } finally {
    clearInterval(keepAlive);
  }
  assertEquals(d.pendingCount, 0);
});

Deno.test("a pending call result does not keep the process alive", () => {
  const d = new Dispatcher();
  // Nothing awaits this and nothing else runs; the unreffed timer must not hold the loop.
  d.waitFor(99n, 1101, 60_000).catch(() => {});
  assertEquals(d.pendingCount, 1);
});

Deno.test("a call result that arrives in time is not rejected", async () => {
  const d = new Dispatcher();
  const promise = d.waitFor(7n, 1101, 5_000);
  d.takePending(7n)!.resolve(new Uint8Array([1]));
  assertEquals(await promise, new Uint8Array([1]));
  assertEquals(d.pendingCount, 0);
});

Deno.test("a deadline of zero waits indefinitely", async () => {
  const d = new Dispatcher();
  const promise = d.waitFor(9n, 1101, 0);
  await new Promise((r) => setTimeout(r, 40));
  assertEquals(d.pendingCount, 1, "still waiting");
  d.takePending(9n)!.resolve(new Uint8Array([2]));
  assertEquals(await promise, new Uint8Array([2]));
});
