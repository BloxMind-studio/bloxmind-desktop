import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PermissionPrompt } from "@/components/PermissionPrompt";

const request = (permission: string) => ({
  id: "perm_1",
  sessionID: "s1",
  permission,
  patterns: [],
  metadata: {},
  always: [],
});

describe("PermissionPrompt", () => {
  it("offers session trust for Open Cloud without a permanent approval", () => {
    const onAlwaysThisSession = vi.fn();
    render(
      <PermissionPrompt
        permission={request("roblox_studio_open_cloud_invoke")}
        onReply={vi.fn()}
        onAlwaysThisSession={onAlwaysThisSession}
      />,
    );

    expect(screen.getByText("Let BloxMind change things on Roblox?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow once" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Always allow" })).toBeNull();
    const session = screen.getByRole("button", { name: "Always allow (this session)" });
    fireEvent.click(session);
    expect(onAlwaysThisSession).toHaveBeenCalledWith("perm_1");
  });

  it("offers session trust for uploads too", () => {
    render(
      <PermissionPrompt
        permission={request("roblox_studio_upload_image")}
        onReply={vi.fn()}
        onAlwaysThisSession={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Always allow (this session)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Always allow" })).toBeNull();
  });

  it("still offers both permanent and session trust for ordinary tools", () => {
    render(
      <PermissionPrompt
        permission={request("bash")}
        onReply={vi.fn()}
        onAlwaysThisSession={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Always allow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Always allow (this session)" })).toBeInTheDocument();
  });
});
