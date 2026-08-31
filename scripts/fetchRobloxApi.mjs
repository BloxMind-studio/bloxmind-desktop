#!/usr/bin/env node
// Fetch the official Roblox API Dump JSON and regenerate src/lib/robloxApiData.ts
// Usage: node scripts/fetchRobloxApi.mjs [--dump-path <path>] [--out <path>]
// By default fetches from the Roblox CDN via the client tracker mirror for reliability.

import { writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DEFAULT_DUMP_URL = "https://raw.githubusercontent.com/MaximumADHD/Roblox-Client-Tracker/roblox/API-Dump.json";
const CDN_VERSION_URL = "https://setup.rbxcdn.com/versionQTStudio";
const CDN_DUMP_TEMPLATE = "https://setup.rbxcdn.com/{version}-API-Dump.json";

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "BloxMind-API-Validator/1.0" } });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  return await res.json();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return (await res.text()).trim();
}

async function getDumpData(cliDumpPath) {
  if (cliDumpPath) {
    const raw = await readFile(cliDumpPath, "utf8");
    return JSON.parse(raw);
  }
  // Try CDN first (official), fallback to GitHub mirror
  try {
    const version = await fetchText(CDN_VERSION_URL);
    const cdnUrl = CDN_DUMP_TEMPLATE.replace("{version}", version);
    console.log(`[fetchRobloxApi] Fetching official dump via CDN version ${version} ...`);
    return await fetchJson(cdnUrl);
  } catch (e) {
    console.warn(`[fetchRobloxApi] CDN fetch failed (${e.message}), falling back to mirror: ${DEFAULT_DUMP_URL}`);
    return await fetchJson(DEFAULT_DUMP_URL);
  }
}

function generateDataFile(data) {
  const enums = Object.fromEntries(data.Enums.map((e) => [e.Name, e.Items.map((i) => i.Name)]));
  const classes = data.Classes;
  const allClasses = classes.map((c) => c.Name);
  const creatable = classes.filter((c) => !(c.Tags && c.Tags.includes("NotCreatable"))).map((c) => c.Name);
  const services = [...new Set(classes.filter((c) => c.Tags && c.Tags.includes("Service")).map((c) => c.Name))].sort();
  const classProps = {};
  for (const c of classes) {
    const props = c.Members.filter((m) => m.MemberType === "Property").map((m) => m.Name);
    if (props.length) classProps[c.Name] = props;
  }

  const lines = [];
  lines.push("// Auto-generated from official Roblox API Dump JSON");
  lines.push("// Source: https://raw.githubusercontent.com/MaximumADHD/Roblox-Client-Tracker/roblox/API-Dump.json");
  lines.push(`// Version: ${data.Version}`);
  lines.push("// Generated: do not edit manually - use scripts/fetchRobloxApi.mjs to regenerate");
  lines.push("// This file provides a trimmed but comprehensive schema for BloxMind's API validator.");
  lines.push("");
  lines.push(`export const ROBLOX_API_VERSION = ${data.Version};`);
  lines.push("");
  lines.push(`export const CREATABLE_CLASSES: ReadonlySet<string> = new Set(${JSON.stringify(creatable, null, 2)} as string[]);`);
  lines.push("");
  lines.push(`export const ALL_CLASSES: ReadonlySet<string> = new Set(${JSON.stringify(allClasses, null, 2)} as string[]);`);
  lines.push("");
  lines.push(`export const SERVICES: ReadonlySet<string> = new Set(${JSON.stringify(services, null, 2)} as string[]);`);
  lines.push("");
  lines.push("export const ENUMS: Readonly<Record<string, ReadonlySet<string>>> = {");
  for (const k of Object.keys(enums).sort()) {
    lines.push(`  ${JSON.stringify(k)}: new Set(${JSON.stringify(enums[k])} as string[]),`);
  }
  lines.push("};");
  lines.push("");
  lines.push(`export const CLASS_PROPERTIES: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(classProps, null, 2)} as const;`);
  lines.push("");
  lines.push("export const FORBIDDEN_CREATABLE: ReadonlySet<string> = new Set([");
  lines.push('  "DirectionalLight",');
  lines.push("]);");
  lines.push("");
  lines.push("export const FORBIDDEN_PROPERTIES: Readonly<Record<string, readonly string[]>> = {");
  lines.push('  "Lighting": ["Technology"],');
  lines.push('  "Sky": ["SunRayColor"],');
  lines.push('  "SunRaysEffect": ["Color","Size","SunRaysSize"],');
  lines.push('  "SunRays": ["Color","Size"],');
  lines.push("};");
  lines.push("");
  lines.push('export const MATERIAL_AS_PARTTYPE = new Set(["Wedge","CornerWedge","Ball","Block","Cylinder"]);');
  lines.push("");
  lines.push('export const VALID_MATERIALS: ReadonlySet<string> = ENUMS["Material"] ?? new Set();');
  lines.push("");
  lines.push('export const VALID_NORMAL_IDS: ReadonlySet<string> = ENUMS["NormalId"] ?? new Set();');

  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  let dumpPath = null;
  let outPath = join(ROOT, "src/lib/robloxApiData.ts");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dump-path") dumpPath = args[++i];
    if (args[i] === "--out") outPath = args[++i];
  }
  console.log("[fetchRobloxApi] Resolving Roblox API dump...");
  const data = await getDumpData(dumpPath);
  console.log(`[fetchRobloxApi] Got dump: Version=${data.Version}, Classes=${data.Classes.length}, Enums=${data.Enums.length}`);
  const fileContent = generateDataFile(data);
  await writeFile(outPath, fileContent, "utf8");
  console.log(`[fetchRobloxApi] Wrote ${outPath} (${fileContent.length} bytes)`);
  console.log("[fetchRobloxApi] Done. Run `pnpm exec tsc --noEmit` to verify types.");
}

main().catch((e) => {
  console.error("[fetchRobloxApi] Fatal:", e);
  process.exit(1);
});
