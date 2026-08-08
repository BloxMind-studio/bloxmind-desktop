import { expect, test, type Page } from "@playwright/test";
import { installAppMocks } from "./helpers/mockBackend";

/**
 * The renderer only reaches the home screen when the desktop bridge and the
 * OpenCode server are available; installAppMocks provides in-page stand-ins
 * for both so the full UI can be exercised in a plain browser.
 */
test.beforeEach(async ({ page }) => {
  await installAppMocks(page);
});

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

async function openTab(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
}

test("shows the startup error screen without the desktop bridge", async ({ context }) => {
  // Fresh page without the beforeEach mocks: a plain browser has no
  // window.BloxMind, so startup must fail gracefully instead of hanging
  // on the loading spinner.
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByText("Setup couldn't finish")).toBeVisible();
});

test("app loads and shows the title bar", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("What would you like to build?")).toBeVisible();
  await expect(page.getByText("BloxMind").first()).toBeVisible();
});

test("shows the home screen with new session button", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("What would you like to build?")).toBeVisible();
  await expect(page.getByRole("button", { name: "New Session", exact: true })).toBeVisible();
  await expect(page.getByText("No sessions yet.")).toBeVisible();
});

test("opens settings from the sidebar and returns to chat", async ({ page }) => {
  await page.goto("/");
  await openSettings(page);
  // Providers is the default tab.
  await expect(page.getByRole("heading", { name: "Providers" })).toBeVisible();

  await page.getByRole("button", { name: "Back to chat" }).click();
  await expect(page.getByText("What would you like to build?")).toBeVisible();
});

test("navigates to General settings tab", async ({ page }) => {
  await page.goto("/");
  await openSettings(page);
  await openTab(page, "General");
  await expect(page.getByText("Accent Color")).toBeVisible();
  await expect(page.getByText("Layout Density")).toBeVisible();
  await expect(page.getByText("Font Size")).toBeVisible();
  await expect(page.getByText("Sound Effects")).toBeVisible();
});

test("persists a preference change from the General tab", async ({ page }) => {
  await page.goto("/");
  await openSettings(page);
  await openTab(page, "General");

  const violet = page.getByRole("button", { name: "Violet" });
  await violet.click();
  await expect(violet).toHaveAttribute("aria-pressed", "true");

  // Preference survives a reload via the config store.
  await page.reload();
  await openSettings(page);
  await openTab(page, "General");
  await expect(page.getByRole("button", { name: "Violet" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("navigates to AI Engine settings tab", async ({ page }) => {
  await page.goto("/");
  await openSettings(page);
  await openTab(page, "AI Engine");
  await expect(page.getByText("Temperature")).toBeVisible();
  await expect(page.getByText("Max Tokens", { exact: true })).toBeVisible();
  await expect(page.getByText("Custom API Endpoint")).toBeVisible();
  await expect(page.getByText("System Prompt")).toBeVisible();
});

test("navigates to Behavior settings tab", async ({ page }) => {
  await page.goto("/");
  await openSettings(page);
  await openTab(page, "Behavior");
  await expect(page.getByText("Auto-scroll on new messages")).toBeVisible();
  await expect(page.getByText("Enter to send", { exact: true })).toBeVisible();
  await expect(page.getByText("Notifications", { exact: true })).toBeVisible();
});

test("navigates to Connection settings tab", async ({ page }) => {
  await page.goto("/");
  await openSettings(page);
  await openTab(page, "Connection");
  await expect(page.getByText("Reconnect Delay (ms)")).toBeVisible();
  await expect(page.getByText("Heartbeat Timeout (ms)")).toBeVisible();
});

test("navigates to Appearance settings tab and switches theme", async ({ page }) => {
  await page.goto("/");
  await openSettings(page);
  await openTab(page, "Appearance");
  await expect(page.getByText("Theme", { exact: true })).toBeVisible();

  const dark = page.getByRole("button", { name: "Dark" });
  await dark.click();
  await expect(dark).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("navigates to Privacy settings tab with data management", async ({ page }) => {
  await page.goto("/");
  await openSettings(page);
  await openTab(page, "Privacy");
  await expect(page.getByText("Share detailed usage analytics")).toBeVisible();
  await expect(page.getByText("Data Management")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export Configuration (JSON)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import Configuration (JSON)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear All Settings" })).toBeVisible();
});

test("navigates to About settings tab", async ({ page }) => {
  await page.goto("/");
  await openSettings(page);
  await openTab(page, "About");
  await expect(page.getByRole("heading", { name: "About BloxMind" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check for updates" })).toBeVisible();
});

test("navigates to Models and Providers tabs", async ({ page }) => {
  await page.goto("/");
  await openSettings(page);
  await expect(page.getByRole("heading", { name: "Providers" })).toBeVisible();

  await openTab(page, "Models");
  await expect(page.getByRole("heading", { name: "Models" })).toBeVisible();
});
