import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModeSwitcher } from "@/components/ModeSwitcher";
import { ModeProvider, useAppMode } from "@/providers/ModeProvider";
import type { AppMode } from "@/types/desktop";

const { patchMock } = vi.hoisted(() => ({ patchMock: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@/lib/config", () => ({
  loadConfig: vi.fn().mockResolvedValue({ activeMode: "roblox" }),
  patchConfig: patchMock,
}));

function Probe() {
  const { mode } = useAppMode();
  return <div data-testid="mode">{mode}</div>;
}

function renderHarness(initialMode?: AppMode) {
  if (initialMode) {
    window.localStorage.setItem("BloxMind-active-mode", initialMode);
  }
  return render(
    <ModeProvider>
      <Probe />
      <ModeSwitcher />
    </ModeProvider>,
  );
}

describe("ModeProvider + ModeSwitcher", () => {
  beforeEach(() => {
    window.localStorage.clear();
    patchMock.mockClear();
    patchMock.mockResolvedValue(undefined);
  });

  it("defaults to roblox mode", () => {
    renderHarness();
    expect(screen.getByTestId("mode").textContent).toBe("roblox");
  });

  it("toggles mode via the switcher and persists the change", async () => {
    renderHarness();

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /agent/i }));
    });

    expect(screen.getByTestId("mode").textContent).toBe("agent");
    expect(patchMock).toHaveBeenCalledWith({ activeMode: "agent" });
    expect(window.localStorage.getItem("BloxMind-active-mode")).toBe("agent");
  });

  it("hydrates the persisted mode from localStorage on mount", () => {
    renderHarness("apps");
    expect(screen.getByTestId("mode").textContent).toBe("apps");
  });
});

describe("ModeSwitcher rendering", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("exposes buttons for all three modes", () => {
    renderHarness();
    expect(screen.getByRole("tab", { name: /roblox/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /agent/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /apps/i })).toBeTruthy();
  });
});
