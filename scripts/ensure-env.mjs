// A ensure-env step for local packaging: electron-builder's `extraResources`
// directive requires a real `.env` file to exist at package time. CI writes one
// from secrets, but local `pnpm package` runs would otherwise fail with
// "Cannot find .env". If no `.env` is present yet, seed it from `.env.example`
// so packaging (and the license bypass mode) work out of the box.
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
const examplePath = resolve(process.cwd(), ".env.example");

if (existsSync(envPath)) {
  console.log("[ensure-env] .env already exists - leaving it as-is.");
} else if (existsSync(examplePath)) {
  copyFileSync(examplePath, envPath);
  console.log("[ensure-env] created .env from .env.example (empty values).");
} else {
  writeFileSync(envPath, "", "utf8");
  console.log("[ensure-env] no .env or .env.example found - created an empty .env.");
}