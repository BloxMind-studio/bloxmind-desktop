import { expect, test } from "@playwright/test";

test("app loads and shows the title bar", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("BloxMind")).toBeVisible();
});

test("shows the home screen with new session button", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("What would you like to build?")).toBeVisible();
  await expect(page.getByRole("button", { name: "New Session" })).toBeVisible();
});

test("opens settings from the sidebar", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByText("Settings", { exact: true })).toBeVisible();
  await expect(page.getByText("Providers", { exact: true })).toBeVisible();
});

test("navigates to General settings tab", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "General" }).click();
  await expect(page.getByText("Accent Color")).toBeVisible();
  await expect(page.getByText("Layout Density")).toBeVisible();
  await expect(page.getByText("Font Size")).toBeVisible();
});

test("navigates to AI Engine settings tab", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "AI Engine" }).click();
  await expect(page.getByText("Temperature")).toBeVisible();
  await expect(page.getByText("Max Tokens")).toBeVisible();
  await expect(page.getByText("System Prompt")).toBeVisible();
});

test("navigates to Behavior settings tab", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Behavior" }).click();
  await expect(page.getByText("Auto-scroll on new messages")).toBeVisible();
  await expect(page.getByText("Enter to send")).toBeVisible();
  await expect(page.getByText("Notifications")).toBeVisible();
});

test("navigates to Connection settings tab", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Connection" }).click();
  await expect(page.getByText("Reconnect Delay (ms)")).toBeVisible();
  await expect(page.getByText("Heartbeat Timeout (ms)")).toBeVisible();
});

test("navigates to Privacy settings tab with data management", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Privacy" }).click();
  await expect(page.getByText("Share detailed usage analytics")).toBeVisible();
  await expect(page.getByText("Export Configuration (JSON)")).toBeVisible();
  await expect(page.getByText("Import Configuration (JSON)")).toBeVisible();
  await expect(page.getByText("Clear All Settings")).toBeVisible();
});

test("navigates to Appearance settings tab", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Appearance" }).click();
  await expect(page.getByText("Theme", { exact: true })).toBeVisible();
  await expect(page.getByText("Light")).toBeVisible();
  await expect(page.getByText("Dark")).toBeVisible();
  await expect(page.getByText("System")).toBeVisible();
});

test("navigates to About settings tab", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "About" }).click();
  await expect(page.getByText("About BloxMind")).toBeVisible();
  await expect(page.getByText("Check for updates")).toBeVisible();
});