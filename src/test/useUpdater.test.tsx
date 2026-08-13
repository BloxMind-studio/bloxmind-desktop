import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/UpdateReleaseNotes", () => ({
  UpdateReleaseNotes: () => null,
}));

// sonner's toast is a bare callable, so replace the whole module. Its named
// methods (warning/error/success/loading/dismiss) mirror the real API shape.
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/lib/desktop", () => ({
  desktop: {
    checkForUpdate: vi.fn(),
    getVersion: vi.fn(),
    installUpdate: vi.fn(),
  },
}));

import { toast } from "sonner";

interface ToastMock {
  (...args: unknown[]): void;
  warning: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  success: ReturnType<typeof vi.fn>;
  loading: ReturnType<typeof vi.fn>;
  dismiss: ReturnType<typeof vi.fn>;
}

const toastCalls = () => toast as unknown as ToastMock;

interface DesktopMock {
  checkForUpdate: ReturnType<typeof vi.fn>;
  getVersion: ReturnType<typeof vi.fn>;
  installUpdate: ReturnType<typeof vi.fn>;
}

async function runUpdater(options: {
  current: string;
  update: { version: string; body: string | null } | null;
  failCheck?: boolean;
}) {
  // Fresh module per test so the module-level "updaterStarted" guard resets.
  vi.resetModules();
  const { desktop } = (await import("@/lib/desktop")) as unknown as { desktop: DesktopMock };
  desktop.getVersion.mockResolvedValue(options.current);
  if (options.failCheck) {
    desktop.checkForUpdate.mockRejectedValue(new Error("network down"));
  } else {
    desktop.checkForUpdate.mockResolvedValue(options.update);
  }
  desktop.installUpdate.mockResolvedValue(undefined);

  const { useUpdater } = await import("@/hooks/useUpdater");
  function Probe() {
    useUpdater();
    return null;
  }
  const view = render(<Probe />);
  // The hook waits 3s before checking so the app can finish rendering.
  await vi.advanceTimersByTimeAsync(3_100);
  view.unmount();
  return desktop as DesktopMock;
}

describe("useUpdater", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("stays silent when the running version equals the latest release", async () => {
    const toastSpy = toastCalls();
    const desktop = await runUpdater({
      current: "0.9.5",
      update: { version: "0.9.5", body: null },
    });

    expect(toastSpy).not.toHaveBeenCalled();
    expect(desktop.installUpdate).not.toHaveBeenCalled();
  });

  it("stays silent when the running version is newer than the latest release", async () => {
    const toastSpy = toastCalls();
    const desktop = await runUpdater({
      current: "0.9.6",
      update: { version: "0.9.5", body: null },
    });

    expect(toastSpy).not.toHaveBeenCalled();
    expect(desktop.installUpdate).not.toHaveBeenCalled();
  });

  it("prompts when a newer minor release exists", async () => {
    const toastSpy = toastCalls();
    const desktop = await runUpdater({
      current: "0.9.5",
      update: { version: "0.10.0", body: "notes" },
    });

    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(desktop.installUpdate).not.toHaveBeenCalled();
  });

  it("auto-installs a strictly newer patch release without prompting", async () => {
    const toastSpy = toastCalls();
    const desktop = await runUpdater({
      current: "0.9.5",
      update: { version: "0.9.6", body: null },
    });

    expect(toastSpy).not.toHaveBeenCalled();
    expect(desktop.installUpdate).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the update check reports nothing", async () => {
    const toastSpy = toastCalls();
    const desktop = await runUpdater({ current: "0.9.5", update: null });

    expect(toastSpy).not.toHaveBeenCalled();
    expect(desktop.installUpdate).not.toHaveBeenCalled();
  });

  it("shows one low-key warning toast when the update check fails", async () => {
    const toastSpy = toastCalls();
    const desktop = await runUpdater({ current: "0.9.5", update: null, failCheck: true });

    expect(toastSpy).not.toHaveBeenCalled();
    expect(toastSpy.warning).toHaveBeenCalledTimes(1);
    expect(desktop.installUpdate).not.toHaveBeenCalled();
  });
});
