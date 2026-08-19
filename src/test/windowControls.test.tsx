/**
 * Window control regression tests.
 *
 * The Electron window is frameless (`frame: false`), so the OS supplies no
 * minimize/maximize/close buttons. These guard the custom titlebar controls:
 * all three buttons exist, they belong to the no-drag region, and each one
 * calls the right desktop bridge method. This guards against a future agent
 * deleting the only way to close the window.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WindowControls } from "@/components/WindowControls";
import { desktop } from "@/lib/desktop";

vi.mock("@/lib/desktop", () => ({
  desktop: {
    windowMinimize: vi.fn().mockResolvedValue(undefined),
    windowMaximizeToggle: vi.fn().mockResolvedValue(undefined),
    windowClose: vi.fn().mockResolvedValue(undefined),
    windowIsMaximized: vi.fn().mockResolvedValue(false),
    onWindowMaximizedChange: vi.fn().mockImplementation((listener: (value: boolean) => void) => {
      listeners.push(listener);
      return () => {};
    }),
  },
}));

const listeners: ((value: boolean) => void)[] = [];

beforeEach(() => {
  listeners.length = 0;
  vi.clearAllMocks();
  vi.mocked(desktop.onWindowMaximizedChange).mockImplementation(
    (listener: (value: boolean) => void) => {
      listeners.push(listener);
      return () => {};
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WindowControls", () => {
  it("renders minimize, maximize, and close buttons in the no-drag titlebar region", () => {
    render(<WindowControls />);

    const container = screen.getByTestId("window-controls");
    expect(container.className).toContain("[-webkit-app-region:no-drag]");

    expect(screen.getByRole("button", { name: "Minimize" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Maximize" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("calls the desktop bridge for each action", () => {
    render(<WindowControls />);

    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    fireEvent.click(screen.getByRole("button", { name: "Maximize" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(desktop.windowMinimize).toHaveBeenCalled();
    expect(desktop.windowMaximizeToggle).toHaveBeenCalled();
    expect(desktop.windowClose).toHaveBeenCalled();
  });

  it("toggles the maximize icon between Maximize and Restore", async () => {
    render(<WindowControls />);
    const maximize = screen.getByRole("button", { name: "Maximize" });
    expect(maximize).toHaveAttribute("title", "Maximize");

    fireEvent.click(screen.getByRole("button", { name: "Maximize" }));
    fireEvent.click(screen.getByRole("button", { name: "Maximize" }));

    act(() => {
      listeners.forEach((listener) => {
        listener(true);
      });
    });

    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();

    act(() => {
      listeners.forEach((listener) => {
        listener(false);
      });
    });
    expect(screen.getByRole("button", { name: "Maximize" })).toBeInTheDocument();
  });
});
