import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/UpdateReleaseNotes", () => ({
  UpdateReleaseNotes: () => null,
}));

// sonner's toast is a bare callable, so replace the whole module.
vi.mock("sonner", () => ({ toast: vi.fn() }));

vi.mock("@/lib/desktop", () => ({
  desktop: {
    checkForUpdate: vi.fn(),
    getVersion: vi.fn(),
    installUpdate: vi.fn(),
  },
}));

import { toast } from "sonner";

const toastCalls = () => toast as unknown as ReturnType<typeof vi.fn>;

interface DesktopMock {
  checkForUpdate: ReturnType<typeof vi.fn>;
  getVersion: ReturnType<typeof vi.fn>;
  installUpdate: ReturnType<typeof vi.fn>;
}

async function runUpdater(options: {
  current: string;
  update: { version: string; body: string | null } | null;
}) {
  // Fresh module per test so the module-level "updaterStarted" guard resets.
  vi.resetModules();
  const { desktop } = (await import("@/lib/desktop")) as unknown as { desktop: DesktopMock };
  desktop.getVersion.mockResolvedValue(options.current);
  desktop.checkForUpdate.mockResolvedValue(options.update);
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
});
