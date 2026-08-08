/**
 * Component tests for the Settings tabs (src/components/settings/*).
 *
 * Each tab is rendered inside the real provider stack (QueryClient +
 * Theme + Preferences) so preference setters round-trip through state.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { AppearanceTab } from "@/components/settings/AppearanceTab";
import { BehaviorTab } from "@/components/settings/BehaviorTab";
import { ConnectionTab } from "@/components/settings/ConnectionTab";
import { EngineTab } from "@/components/settings/EngineTab";
import { ThemeProvider } from "@/components/theme-provider";
import { PreferencesProvider } from "@/providers/PreferencesProvider";

function renderTab(tab: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <PreferencesProvider>{tab}</PreferencesProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

// ── AppearanceTab ────────────────────────────────────────────────────────

describe("AppearanceTab", () => {
  it("renders all theme options and switches theme on click", () => {
    renderTab(<AppearanceTab />);

    const light = screen.getByText("Light").closest("button") as HTMLButtonElement;
    const dark = screen.getByText("Dark").closest("button") as HTMLButtonElement;
    const system = screen.getByText("System").closest("button") as HTMLButtonElement;

    // Default theme is "system".
    expect(system).toHaveAttribute("aria-pressed", "true");
    expect(dark).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(dark);
    expect(dark).toHaveAttribute("aria-pressed", "true");
    expect(system).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(light);
    expect(light).toHaveAttribute("aria-pressed", "true");
    expect(dark).toHaveAttribute("aria-pressed", "false");
  });
});

// ── BehaviorTab ──────────────────────────────────────────────────────────

describe("BehaviorTab", () => {
  it("toggles each behavior switch", () => {
    renderTab(<BehaviorTab />);

    const autoScroll = screen.getByRole("switch", { name: "Auto-scroll" });
    const enterToSend = screen.getByRole("switch", { name: "Enter to send" });
    const notifications = screen.getByRole("switch", { name: "Notifications" });

    // All enabled by default.
    expect(autoScroll).toHaveAttribute("aria-checked", "true");
    expect(enterToSend).toHaveAttribute("aria-checked", "true");
    expect(notifications).toHaveAttribute("aria-checked", "true");

    fireEvent.click(autoScroll);
    expect(autoScroll).toHaveAttribute("aria-checked", "false");

    fireEvent.click(notifications);
    expect(notifications).toHaveAttribute("aria-checked", "false");

    // Enter to send stays untouched.
    expect(enterToSend).toHaveAttribute("aria-checked", "true");
  });
});

// ── ConnectionTab ────────────────────────────────────────────────────────

describe("ConnectionTab", () => {
  it("accepts in-range values and clamps out-of-range values", () => {
    const { container } = renderTab(<ConnectionTab />);

    const [reconnect, heartbeat] =
      container.querySelectorAll<HTMLInputElement>('input[type="number"]');
    expect(reconnect).toBeDefined();
    expect(heartbeat).toBeDefined();

    // Valid value passes through.
    fireEvent.change(reconnect, { target: { value: "2500" } });
    expect(reconnect.value).toBe("2500");

    // Below minimum → clamped to 1,000.
    fireEvent.change(reconnect, { target: { value: "10" } });
    expect(reconnect.value).toBe("1000");

    // Above maximum → clamped to 60,000.
    fireEvent.change(reconnect, { target: { value: "999999" } });
    expect(reconnect.value).toBe("60000");

    // Heartbeat clamps into its own 5,000–120,000 range.
    fireEvent.change(heartbeat, { target: { value: "1" } });
    expect(heartbeat.value).toBe("5000");
    fireEvent.change(heartbeat, { target: { value: "999999" } });
    expect(heartbeat.value).toBe("120000");
  });
});

// ── EngineTab ────────────────────────────────────────────────────────────

describe("EngineTab", () => {
  it("clamps max tokens into the 256–128,000 range", () => {
    const { container } = renderTab(<EngineTab />);

    const maxTokens = container.querySelector<HTMLInputElement>(
      'input[type="number"]',
    ) as HTMLInputElement;
    expect(maxTokens.value).toBe("4096"); // default

    fireEvent.change(maxTokens, { target: { value: "100" } });
    expect(maxTokens.value).toBe("256");

    fireEvent.change(maxTokens, { target: { value: "999999" } });
    expect(maxTokens.value).toBe("128000");
  });

  it("updates the system prompt and custom endpoint", () => {
    const { container } = renderTab(<EngineTab />);

    const textarea = screen.getByPlaceholderText(
      "You are a helpful AI assistant...",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "You are BloxMind." } });
    expect(textarea.value).toBe("You are BloxMind.");

    const endpoint = screen.getByPlaceholderText("https://api.example.com/v1") as HTMLInputElement;
    fireEvent.change(endpoint, { target: { value: "https://custom.example.com" } });
    expect(endpoint.value).toBe("https://custom.example.com");

    // Setting an endpoint reveals the reset action; clicking clears it.
    const reset = screen.getByText("Reset to default");
    fireEvent.click(reset);
    expect(endpoint.value).toBe("");
    expect(screen.queryByText("Reset to default")).not.toBeInTheDocument();
    expect(container.querySelector("textarea")).toBe(textarea);
  });

  it("shows the temperature value formatted to two decimals", () => {
    const { container } = renderTab(<EngineTab />);

    expect(screen.getByText("0.70")).toBeInTheDocument();

    const slider = container.querySelector<HTMLInputElement>('input[type="range"]');
    fireEvent.change(slider as HTMLInputElement, { target: { value: "0.25" } });
    expect(screen.getByText("0.25")).toBeInTheDocument();
  });
});
