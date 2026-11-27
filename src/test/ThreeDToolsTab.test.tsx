import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  install: vi.fn(),
  cancel: vi.fn(),
  open: vi.fn(),
  remove: vi.fn(),
  dispose: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  listener: null as ((progress: unknown) => void) | null,
}));

vi.mock("@/lib/desktop", () => ({
  desktop: {
    getBlenderToolsState: mocks.getState,
    installBlenderTools: mocks.install,
    cancelBlenderTools: mocks.cancel,
    openBlender: mocks.open,
    removeBlenderTools: mocks.remove,
    getUploadAccess: async () => ({
      state: "no_studio",
      readOn: false,
      writeOn: false,
      folder: "/home/BloxMind/Models",
      folderUrl: "file:///home/BloxMind/Models",
    }),
    onBlenderSetupProgress: (listener: (progress: unknown) => void) => {
      mocks.listener = listener;
      return () => {};
    },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("@/providers/StudioTargetProvider", () => ({
  useStudioTargetOptional: () => null,
}));
vi.mock("@/providers/OpenCodeClientProvider", () => ({
  useOpenCodeClient: () => ({ client: { location: { reload: mocks.dispose } } }),
}));

import { ThreeDToolsTab } from "@/components/ThreeDToolsTab";

const start = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ThreeDToolsTab />
    </QueryClientProvider>,
  );

describe("ThreeDToolsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.install.mockResolvedValue(undefined);
    mocks.dispose.mockResolvedValue(true);
  });

  it("says what Blender costs in space and risk before anyone commits", async () => {
    mocks.getState.mockResolvedValue({ state: "not_installed" });
    start();

    expect(await screen.findByRole("button", { name: "Set up Blender" })).toBeVisible();
    expect(screen.getByText(/1\.1 GB once installed/)).toBeVisible();
    expect(screen.getByText(/runs code the AI writes/)).toBeVisible();
    expect(screen.getByText(/BloxMind earns nothing/)).toBeVisible();
  });

  it("shows how far setup has got, and has OpenCode pick it up", async () => {
    mocks.getState.mockResolvedValue({ state: "not_installed" });
    let finish = () => {};
    mocks.install.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    start();
    fireEvent.click(await screen.findByRole("button", { name: "Set up Blender" }));
    await screen.findByRole("button", { name: "Stop" });

    mocks.listener?.({ step: "downloading", downloadedBytes: 40, totalBytes: 100 });
    expect(await screen.findByText("Downloading 40%")).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");

    finish();
    await waitFor(() => expect(mocks.dispose).toHaveBeenCalledOnce());
  });

  it("doesn't call setup failed when only OpenCode's reload fails", async () => {
    mocks.getState.mockResolvedValue({ state: "not_installed" });
    mocks.dispose.mockRejectedValue(new Error("reload failed"));
    start();
    fireEvent.click(await screen.findByRole("button", { name: "Set up Blender" }));

    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith("Blender is ready", {
        description: "Restart BloxMind so the AI can use it.",
      }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains a failure and offers another go", async () => {
    mocks.getState.mockResolvedValue({ state: "not_installed" });
    mocks.install.mockRejectedValue(new Error("This needs about 2 GB free (reason: disk_full)"));
    start();
    fireEvent.click(await screen.findByRole("button", { name: "Set up Blender" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Your drive is nearly full");
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  it("doesn't call stopping a failure", async () => {
    mocks.getState.mockResolvedValue({ state: "not_installed" });
    let fail = (_error: Error) => {};
    mocks.install.mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    start();
    fireEvent.click(await screen.findByRole("button", { name: "Set up Blender" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    expect(mocks.cancel).toHaveBeenCalledOnce();

    fail(new Error("Setup was stopped (reason: other)"));

    expect(await screen.findByRole("button", { name: "Set up Blender" })).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("opens Blender", async () => {
    mocks.getState.mockResolvedValue({ state: "ready", running: false });
    start();
    fireEvent.click(await screen.findByRole("button", { name: "Open Blender" }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledOnce());
  });

  it("says deleting leaves no Blender files behind", async () => {
    mocks.getState.mockResolvedValue({ state: "ready", running: false });
    start();

    expect(
      await screen.findByText(/Deleting removes Blender, its Start Menu entry, its app list entry/),
    ).toBeVisible();
  });

  it("says when Blender is connected", async () => {
    mocks.getState.mockResolvedValue({ state: "ready", running: true });
    start();

    expect(await screen.findByText("Open")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Open Blender" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete Blender" })).toBeNull();
    expect(screen.getByText(/Close Blender to delete it/)).toBeVisible();
  });

  it("removes it and has OpenCode forget it", async () => {
    mocks.getState.mockResolvedValue({ state: "ready", running: false });
    mocks.remove.mockResolvedValue(undefined);
    start();
    fireEvent.click(await screen.findByRole("button", { name: "Delete Blender" }));

    await waitFor(() => expect(mocks.dispose).toHaveBeenCalledOnce());
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it("reloads OpenCode and tries again when its server is still holding the files", async () => {
    mocks.getState.mockResolvedValue({ state: "ready", running: false });
    mocks.remove
      .mockRejectedValueOnce(
        new Error(
          "Failed to remove Blender: Error invoking remote method 'blender:remove': " +
            "DesktopMainError: Couldn't remove Blender (locked)",
        ),
      )
      .mockResolvedValue(undefined);
    start();
    fireEvent.click(await screen.findByRole("button", { name: "Delete Blender" }));

    await waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(2));
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("says Blender is still running when it's open, after the retry too", async () => {
    mocks.getState.mockResolvedValue({ state: "ready", running: false });
    mocks.remove.mockRejectedValue(
      new Error(
        "Failed to remove Blender: Error invoking remote method 'blender:remove': " +
          "DesktopMainError: Couldn't remove Blender (locked)",
      ),
    );
    start();
    fireEvent.click(await screen.findByRole("button", { name: "Delete Blender" }));

    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith("Couldn't remove Blender", {
        description: "Blender is still running. Close it, then try again.",
      }),
    );
    expect(mocks.remove).toHaveBeenCalledTimes(2);
  });

  it("shows the real reason when deleting fails for something else", async () => {
    mocks.getState.mockResolvedValue({ state: "ready", running: false });
    mocks.remove.mockRejectedValue(
      new Error(
        "Failed to remove Blender: Error invoking remote method 'blender:remove': " +
          "DesktopMainError: Couldn't remove Blender: ENOENT: no such file or directory",
      ),
    );
    start();
    fireEvent.click(await screen.findByRole("button", { name: "Delete Blender" }));

    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith("Couldn't remove Blender", {
        description: "Couldn't remove Blender: ENOENT: no such file or directory",
      }),
    );
    expect(mocks.dispose).not.toHaveBeenCalled();
  });

  it("counts the delete as done even when OpenCode won't reload", async () => {
    mocks.getState.mockResolvedValue({ state: "ready", running: false });
    mocks.remove.mockResolvedValue(undefined);
    mocks.dispose.mockRejectedValue(new Error("reload failed"));
    start();
    fireEvent.click(await screen.findByRole("button", { name: "Delete Blender" }));

    await waitFor(() => expect(mocks.dispose).toHaveBeenCalledOnce());
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("shows the upload folder the agent is told to export to", async () => {
    start();

    expect(await screen.findByText("/home/BloxMind/Models")).toBeVisible();
    expect(screen.getByText(/Studio only allows uploads from this folder/)).toBeVisible();
  });

  it("doesn't offer it where it can't run", async () => {
    mocks.getState.mockResolvedValue({ state: "unsupported" });
    start();

    expect(await screen.findByText("Not available on this computer.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Set up Blender" })).toBeNull();
  });
});
