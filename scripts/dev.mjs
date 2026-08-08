#!/usr/bin/env node
/**
 * Dev wrapper that kills the whole spawned process tree on exit.
 *
 * `vite` (with vite-plugin-electron) spawns `electron`, which spawns
 * `rojo.exe` and `opencode.exe`. When the dev command is interrupted
 * (Ctrl+C, terminal close, vite restart) those children can survive and
 * hold file locks / port 34872. This wrapper tracks the root child and,
 * on any exit path, force-kills the entire tree:
 *   - Windows: `taskkill /F /T /PID <pid>` (tree kill)
 *   - POSIX:   `process.kill(-pid)` against the detached process group
 */
import { execFileSync, spawn } from "node:child_process";

const isWindows = process.platform === "win32";

const child = spawn("vite", [], {
  stdio: "inherit",
  // On Windows, run through cmd so PATH resolution matches pnpm scripts;
  // taskkill /T then covers cmd -> vite -> electron -> rojo/opencode.
  shell: isWindows,
  // On POSIX, run in its own process group so we can kill the whole tree
  // with a single signal.
  detached: !isWindows,
});

let killed = false;

function killTree() {
  if (killed || child.pid === undefined) return;
  killed = true;
  try {
    if (isWindows) {
      execFileSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
        stdio: "ignore",
      });
    } else {
      // Negative PID targets the entire process group.
      process.kill(-child.pid, "SIGKILL");
    }
  } catch {
    // Children already exited — nothing to do.
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    killTree();
    process.exit(130);
  });
}

process.on("exit", killTree);

child.on("error", (error) => {
  console.error(`[dev] failed to start vite: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  killTree();
  process.exit(signal ? 1 : (code ?? 0));
});
