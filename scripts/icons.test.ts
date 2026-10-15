import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/**
 * Every `icon:` entry in electron-builder.yml must exist and live in the
 * single canonical icon directory (electron/icons). A duplicated copy in
 * public/ previously drifted and shipped a 32x32-only .ico that broke the
 * Windows release build.
 */
test("electron-builder icons exist and come from the canonical icons directory", () => {
  const config = readFileSync(join(repoRoot, "electron-builder.yml"), "utf8");
  const iconPaths = [...config.matchAll(/^\s*icon:\s*(.+)$/gm)].map((m) => m[1].trim());

  assert.ok(iconPaths.length >= 3, "expected mac/win/linux icon entries");
  for (const iconPath of iconPaths) {
    assert.ok(
      iconPath.startsWith("electron/icons/"),
      `icon "${iconPath}" must live in electron/icons/ (single canonical source)`,
    );
    assert.ok(existsSync(join(repoRoot, iconPath)), `icon "${iconPath}" is missing`);
  }
});

test("public/ icon copies never drift from the canonical electron/icons", () => {
  // electron/icons is canonical; public/ may carry copies for the renderer,
  // but they must stay byte-identical so a drifted copy can never ship.
  const pairs: Array<[canonical: string, copy: string]> = [
    ["electron/icons/icon.ico", "public/bloxbot-svg.ico"],
    ["electron/icons/icon.png", "public/bloxbot-svg.png"],
    ["electron/icons/icon.icns", "public/bloxbot-svg.icns"],
  ];

  for (const [canonical, copy] of pairs) {
    const canonicalPath = join(repoRoot, canonical);
    const copyPath = join(repoRoot, copy);
    if (!existsSync(copyPath)) continue; // copy removed — nothing to drift
    assert.equal(
      sha256(copyPath),
      sha256(canonicalPath),
      `${copy} drifted from ${canonical} — regenerate it from the canonical icon`,
    );
  }
});
