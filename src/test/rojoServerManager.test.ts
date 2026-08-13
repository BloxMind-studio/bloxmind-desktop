import { describe, expect, it, vi } from "vitest";

import { boundedKill, cleanupRojo } from "../../electron/services/RojoServerManager";

describe("boundedKill", () => {
  it("resolves promptly when the kill completes normally", async () => {
    let killed = false;
    await expect(
      boundedKill(async () => {
        killed = true;
      }, 1_000),
    ).resolves.toBeUndefined();
    expect(killed).toBe(true);
  });

  it("resolves (never rejects) when the kill throws", async () => {
    await expect(
      boundedKill(async () => {
        throw new Error("kill failed");
      }, 1_000),
    ).resolves.toBeUndefined();
  });

  it("resolves once the timeout fires even when the kill hangs", async () => {
    vi.useFakeTimers();
    try {
      let killStarted = false;
      const promise = boundedKill(
        () =>
          new Promise<void>(() => {
            killStarted = true;
            // Never resolves — simulates a hung kill.
          }),
        3_000,
      );
      expect(killStarted).toBe(true);
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(promise).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("cleanupRojo", () => {
  it("resolves (never rejects) with no active rojo runtime", async () => {
    await expect(cleanupRojo()).resolves.toBeUndefined();
  });
});
