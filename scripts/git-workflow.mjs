#!/usr/bin/env node
/**
 * BloxMind Git Workflow Manager — Feature Branch Isolation Guardrails
 *
 * Enforces the professional Git Feature Branch Workflow for the 3-repo
 * BloxMind organization. This script is the single source of truth for
 * branch creation, verification, and safe merging.
 *
 * Usage:
 *   node scripts/git-workflow.mjs create <branch>     # verify not on main, create & switch
 *   node scripts/git-workflow.mjs verify              # run tsc + tests in current branch
 *   node scripts/git-workflow.mjs merge <branch>      # checkout main, pull, merge, push, cleanup
 *   node scripts/git-workflow.mjs status              # show current branch and remote check
 *
 * Rules (see .clinerules § Feature Branching and opencode.jsonc instructions):
 *   1. Never commit directly to `main` — auto-create feature/fix/refactor/chore branch.
 *   2. Develop & test entirely inside the feature branch; run `npx tsc --noEmit` and tests before merge.
 *   3. Safe merge: checkout main → pull → merge → push → delete branch.
 *   4. Multi-repo routing still applies — resolve target repo via electron/opencodeConfig.ts.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

function exec(cmd, opts = {}) {
  const result = execSync(cmd, { encoding: "utf8", stdio: "pipe", ...opts });
  if (typeof result === "string") return result.trim();
  if (result instanceof Buffer) return result.toString("utf8").trim();
  return "";
}

function getCurrentBranch() {
  return exec("git branch --show-current");
}

function getChangedFiles() {
  try {
    const staged = exec("git diff --name-only --cached");
    const unstaged = exec("git diff --name-only");
    const all = [staged, unstaged].filter(Boolean).join("\n");
    return all.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function assertNotOnMain({ allowMain = false } = {}) {
  const branch = getCurrentBranch();
  if (branch === "main" && !allowMain) {
    console.error(`\n✖ You are on 'main'. Direct commits to main are forbidden.\n  Create a feature branch first:\n    node scripts/git-workflow.mjs create feature/<short-description>\n  or\n    git checkout -b feature/<short-description>\n`);
    process.exit(1);
  }
  return branch;
}

export function createBranch(branchName) {
  if (!branchName) {
    console.error("Usage: node scripts/git-workflow.mjs create <branch>");
    console.error("  branch must match feature/<desc> | fix/<desc> | refactor/<desc> | chore/<desc>");
    process.exit(1);
  }
  const valid = /^(feature|fix|refactor|chore)\/[a-z0-9-]+$/;
  if (!valid.test(branchName)) {
    console.error(`Invalid branch name "${branchName}". Expected: feature/<kebab-case>, fix/<kebab-case>, refactor/<kebab-case>, chore/<kebab-case>`);
    process.exit(1);
  }
  const current = getCurrentBranch();
  if (current === branchName) {
    console.log(`Already on '${branchName}'.`);
    return;
  }
  // Ensure working tree is clean before switching?
  try {
    exec(`git checkout -b ${branchName}`);
    console.log(`✓ Created and switched to '${branchName}' (from '${current}')`);
  } catch (e) {
    // If branch already exists locally, just checkout
    try {
      exec(`git checkout ${branchName}`);
      console.log(`✓ Switched to existing branch '${branchName}'`);
    } catch {
      console.error(`Failed to create/switch to '${branchName}': ${e.message}`);
      process.exit(1);
    }
  }
}

export function verifyBranch() {
  const branch = getCurrentBranch();
  console.log(`\n▶ Verifying branch '${branch}'...`);
  console.log("  → npx tsc --noEmit");
  exec("npx tsc --noEmit", { stdio: "inherit" });
  console.log("  ✓ typecheck passed");

  // Also check electron and scripts tsconfigs if they exist
  for (const proj of ["electron/tsconfig.json", "scripts/tsconfig.json"]) {
    if (existsSync(proj)) {
      console.log(`  → npx tsc -p ${proj} --noEmit`);
      exec(`npx tsc -p ${proj} --noEmit`, { stdio: "inherit" });
      console.log(`  ✓ ${proj} passed`);
    }
  }

  console.log("  → pnpm exec vitest run (unit tests)");
  exec("pnpm exec vitest run", { stdio: "inherit" });
  console.log(`\n✓ Branch '${branch}' verified — ready to merge.`);
}

export function mergeBranch(branchName) {
  if (!branchName) {
    console.error("Usage: node scripts/git-workflow.mjs merge <branch>");
    process.exit(1);
  }
  const current = getCurrentBranch();
  console.log(`\n▶ Merging '${branchName}' into main (from '${current}')...`);

  // Ensure branch exists
  try {
    exec(`git rev-parse --verify ${branchName}`);
  } catch {
    console.error(`Branch '${branchName}' does not exist.`);
    process.exit(1);
  }

  // Verify first
  verifyBranch();

  console.log(`\n  → git checkout main`);
  exec("git checkout main", { stdio: "inherit" });
  console.log(`  → git pull origin main`);
  exec("git pull origin main", { stdio: "inherit" });
  console.log(`  → git merge ${branchName} --no-ff`);
  try {
    exec(`git merge ${branchName} --no-ff -m "Merge ${branchName} into main"`, { stdio: "inherit" });
  } catch (e) {
    console.error(`\n✖ Merge conflict — resolve manually, then push.`);
    process.exit(1);
  }
  console.log(`  → git push origin main`);
  exec("git push origin main", { stdio: "inherit" });
  console.log(`  → git branch -d ${branchName}`);
  try {
    exec(`git branch -d ${branchName}`);
    console.log(`✓ Cleaned up local branch '${branchName}'.`);
  } catch {
    console.warn(`Could not delete local branch '${branchName}' (maybe not fully merged). Use -D if needed.`);
  }
  // Also push to secondary remote if it exists
  try {
    const remotes = exec("git remote");
    if (remotes.split("\n").includes("orgrelease")) {
      console.log(`  → git push orgrelease main (secondary)`);
      exec("git push orgrelease main", { stdio: "inherit" });
    }
    // Also ensure YUouriii fork stays in sync if it still exists
    try {
      exec("git ls-remote https://github.com/YUouriii/app-BloxMind-ai.git main", { stdio: "pipe" });
      console.log(`  → git push https://github.com/YUouriii/app-BloxMind-ai.git main`);
      exec("git push https://github.com/YUouriii/app-BloxMind-ai.git main", { stdio: "inherit" });
    } catch {
      // fork deleted or unreachable — ignore
    }
  } catch {
    // ignore secondary push failures
  }
  console.log(`\n✓ Merge complete — main is clean and up to date.`);
}

function status() {
  const branch = getCurrentBranch();
  const remote = (() => {
    try {
      return exec("git remote get-url origin");
    } catch {
      return "(no origin)";
    }
  })();
  const changed = getChangedFiles();
  console.log(`\nBranch: ${branch}`);
  console.log(`Remote origin: ${remote}`);
  console.log(`Changed files: ${changed.length ? changed.join(", ") : "(clean)"}`);
  if (branch === "main" && changed.length > 0) {
    console.warn("\n⚠ You are on 'main' with changes — create a feature branch before committing.");
  }
  // Try to resolve target repo if the helper exists
  try {
    const { resolveTargetRepo } = awaitImportOpencodeConfig();
    if (changed.length) {
      const target = resolveTargetRepo(changed);
      console.log(`Resolved target repo: ${target ?? "(mixed — split commits)"}`);
    }
  } catch {
    // ignore
  }
}

function awaitImportOpencodeConfig() {
  // Lazy import to avoid ESM issues when running via node directly
  // This is intentionally synchronous via dynamic import cache
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = eval("require")("../electron/opencodeConfig.ts");
    return mod;
  } catch {
    return { resolveTargetRepo: () => null };
  }
}

// CLI
const [, , cmd, arg] = process.argv;
switch (cmd) {
  case "create":
    createBranch(arg);
    break;
  case "verify":
    verifyBranch();
    break;
  case "merge":
    mergeBranch(arg);
    break;
  case "status":
    status();
    break;
  case undefined:
    console.log(`BloxMind Git Workflow Manager
Usage:
  node scripts/git-workflow.mjs create <branch>   # create & switch (feature/*, fix/*, refactor/*, chore/*)
  node scripts/git-workflow.mjs verify            # typecheck + tests in current branch
  node scripts/git-workflow.mjs merge <branch>    # verify, checkout main, pull, merge, push, cleanup
  node scripts/git-workflow.mjs status            # show branch, remote, changed files, target repo
`);
    break;
  default:
    console.error(`Unknown command: ${cmd}`);
    process.exit(1);
}

