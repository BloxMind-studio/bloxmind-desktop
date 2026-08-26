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
/** Session list returned by the useSessions mock (mutate between renders). */
let sessionsForTest: Array<{ id: string; title: string | null }> = [
  { id: "session_abc123", title: "My Cool Game" },
];

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

vi.mock("@/hooks/useSessions", () => ({
  useSessions: () => ({ data: sessionsForTest }),
}));

describe("RojoStatusBadge session isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeSessionIdForTest = "session_abc123";
    sessionsForTest = [{ id: "session_abc123", title: "My Cool Game" }];
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

  it("shows the active session title and opens the folder when clicked", async () => {
    render(<RojoStatusBadge />);
    // Initial status resolves from the desktop bridge.
    expect(await screen.findByText("Rojo Active (Port 34872)")).toBeInTheDocument();

    // Unified badge shows the human-readable title, not the raw id, with the
    // standard tooltip and a single accessible name.
    expect(screen.getByText("My Cool Game")).toBeInTheDocument();
    expect(screen.queryByText("session_abc123")).not.toBeInTheDocument();
    const badge = screen.getByLabelText("Open session workspace folder");
    expect(badge).toHaveAttribute("title", "Open session workspace folder");

    // Clicking the unified badge invokes the desktop bridge for the active session.
    fireEvent.click(badge);
    expect(mocks.openSessionWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.openSessionWorkspace).toHaveBeenCalledWith("session_abc123");
  });

  it("renders exactly one session control (no duplicate standalone folder button)", async () => {
    render(<RojoStatusBadge />);
    await screen.findByText("Rojo Active (Port 34872)");
    const controls = screen.getAllByLabelText("Open session workspace folder");
    expect(controls).toHaveLength(1);
    // The whole badge is one interactive <button>, not a span + separate button.
    expect(controls[0].tagName).toBe("BUTTON");
    expect(controls[0]).toHaveTextContent("My Cool Game");
  });

  it("falls back to the raw session id when no title exists", async () => {
    sessionsForTest = [{ id: "session_abc123", title: null }];
    render(<RojoStatusBadge />);
    await screen.findByText("Rojo Active (Port 34872)");
    expect(screen.getByText("session_abc123")).toBeInTheDocument();
  });

  it("updates the displayed title dynamically when the session is renamed", async () => {
    const view = render(<RojoStatusBadge />);
    await screen.findByText("My Cool Game");

    // Simulate a rename propagating through React Query.
    sessionsForTest = [{ id: "session_abc123", title: "Renamed Adventure" }];
    view.rerender(<RojoStatusBadge />);

    expect(screen.getByText("Renamed Adventure")).toBeInTheDocument();
    expect(screen.queryByText("My Cool Game")).not.toBeInTheDocument();
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
