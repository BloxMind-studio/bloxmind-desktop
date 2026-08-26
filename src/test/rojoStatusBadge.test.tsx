/**
 * RojoStatusBadge session-isolation regression tests.
 *
 * Guards the session-isolation visual indicators: when a session is active the
 * badge shows which session folder Rojo targets, and the folder button reveals
 * that exact session workspace via the desktop bridge.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RojoStatusBadge } from "@/components/RojoStatusBadge";

const mocks = {
  rojoStatus: vi.fn(),
  rojoToggle: vi.fn(),
  rojoToggleForSession: vi.fn(),
  getOpenCodeInfo: vi.fn(),
  openSessionWorkspace: vi.fn(),
};

let activeSessionIdForTest: string | null = "session_abc123";

vi.mock("@/lib/desktop", () => ({
  desktop: {
    rojoStatus: (...args: unknown[]) => mocks.rojoStatus(...args),
    rojoToggle: (...args: unknown[]) => mocks.rojoToggle(...args),
    rojoToggleForSession: (...args: unknown[]) => mocks.rojoToggleForSession(...args),
    getOpenCodeInfo: (...args: unknown[]) => mocks.getOpenCodeInfo(...args),
    openSessionWorkspace: (...args: unknown[]) => mocks.openSessionWorkspace(...args),
  },
}));

vi.mock("@/providers/ActiveSessionProvider", () => ({
  useActiveSession: () => ({ activeSessionId: activeSessionIdForTest }),
}));

describe("RojoStatusBadge session isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeSessionIdForTest = "session_abc123";
    mocks.rojoStatus.mockResolvedValue({
      active: true,
      port: 34872,
      error: null,
      workspace: "C:\\Users\\dev\\BloxMind\\sessions\\session_abc123",
      clientConnected: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not show the session indicator when no session is active", async () => {
    activeSessionIdForTest = null;
    render(<RojoStatusBadge />);
    await screen.findByText("Rojo Active (Port 34872)");
    expect(screen.queryByLabelText("Open session workspace folder")).not.toBeInTheDocument();
  });

  it("shows the active session folder and lets the user open it in the file explorer", async () => {
    render(<RojoStatusBadge />);
    // Initial status resolves from the desktop bridge.
    expect(await screen.findByText("Rojo Active (Port 34872)")).toBeInTheDocument();

    // Session-isolation indicator exposes the session folder name.
    expect(screen.getByText("session_abc123")).toBeInTheDocument();

    // Folder button invokes the desktop bridge for the active session.
    const folderButton = screen.getByLabelText("Open session workspace folder");
    fireEvent.click(folderButton);
    expect(mocks.openSessionWorkspace).toHaveBeenCalledWith("session_abc123");
  });

  it("surfaces an error toast when opening the workspace fails", async () => {
    const { toast } = await import("sonner");
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "id" as never);
    mocks.openSessionWorkspace.mockRejectedValueOnce(new Error("nope"));
    render(<RojoStatusBadge />);
    await screen.findByText("Rojo Active (Port 34872)");
    fireEvent.click(screen.getByLabelText("Open session workspace folder"));
    expect(mocks.openSessionWorkspace).toHaveBeenCalledWith("session_abc123");
    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to open session workspace",
        expect.objectContaining({ description: expect.stringContaining("file explorer") }),
      ),
    );
  });
});
