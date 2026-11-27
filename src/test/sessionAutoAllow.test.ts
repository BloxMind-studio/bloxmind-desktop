import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isSessionAutoAllow,
  setSessionAutoAllow,
  subscribeSessionAutoAllow,
} from "../lib/sessionAutoAllow";

afterEach(() => {
  setSessionAutoAllow("s1", false);
  setSessionAutoAllow("s2", false);
});

describe("session auto-allow", () => {
  it("is keyed by session and off by default", () => {
    expect(isSessionAutoAllow(null)).toBe(false);
    expect(isSessionAutoAllow("s1")).toBe(false);

    setSessionAutoAllow("s1", true);
    expect(isSessionAutoAllow("s1")).toBe(true);
    expect(isSessionAutoAllow("s2")).toBe(false);

    setSessionAutoAllow("s1", false);
    expect(isSessionAutoAllow("s1")).toBe(false);
  });

  it("notifies subscribers when it changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSessionAutoAllow(listener);

    setSessionAutoAllow("s1", true);
    setSessionAutoAllow("s1", false);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    setSessionAutoAllow("s1", true);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
