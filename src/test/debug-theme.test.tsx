import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { qk } from "@/lib/queryKeys";
import { PreferencesProvider, useUIPreferences } from "@/providers/PreferencesProvider";
import { DEFAULT_APP_CONFIG } from "@/types/desktop";

function ThemeProbe() {
  const { theme } = useTheme();
  return <span data-testid="theme">{theme}</span>;
}

function PresetButton() {
  const { setThemePreset } = useUIPreferences();
  return (
    <button type="button" onClick={() => setThemePreset("emerald")}>
      preset
    </button>
  );
}

function ThemeSetter() {
  const { setTheme } = useTheme();
  return (
    <button type="button" onClick={() => setTheme("light")}>
      set-light
    </button>
  );
}

describe("theme mode persistence", () => {
  it("preserves the active theme when a color preset is changed", async () => {
    window.localStorage.clear();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(qk.config, { ...DEFAULT_APP_CONFIG, theme: "dark" });
    render(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <PreferencesProvider>
            <ThemeProbe />
            <ThemeSetter />
            <PresetButton />
          </PreferencesProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("theme")).toHaveTextContent("system"));
    expect(qc.getQueryData(qk.config)).toMatchObject({ theme: "system" });

    // User picks Light. setTheme persists to file and updates the cache.
    fireEvent.click(screen.getByText("set-light"));
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect((qc.getQueryData(qk.config) as { theme: string }).theme).toBe("light");

    // User switches a color preset. This must not change the theme.
    fireEvent.click(screen.getByText("preset"));

    const cached = qc.getQueryData(qk.config) as { theme: string } | undefined;
    expect(cached?.theme).toBe("light");
    // FIX: the active theme ("light") is preserved across the preset change.
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
  });
});
