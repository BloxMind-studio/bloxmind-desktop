import { describe, expect, it } from "vitest";

import {
  parseParentPids,
  parseTasklistPids,
  sweepStaleProcesses,
} from "../../electron/services/staleProcessSweep";

describe("parseTasklistPids", () => {
  it("extracts PIDs from CSV tasklist output", () => {
    const output = [
      '"rojo.exe","12345","Console","1","1,234 K"',
      '"rojo.exe","678","Console","1","512 K"',
    ].join("\r\n");
    expect(parseTasklistPids(output)).toEqual([12_345, 678]);
  });

  it("ignores INFO lines and malformed rows", () => {
    const output = 'INFO: No tasks are running which match the specified criteria.\r\n""';
    expect(parseTasklistPids(output)).toEqual([]);
  });
});

describe("parseParentPids", () => {
  it("parses pid,parentPid lines into a map", () => {
    const output = "123,999\r\n456,1000\r\n\r\ngarbage";
    const parents = parseParentPids(output);
    expect(parents.get(123)).toBe(999);
    expect(parents.get(456)).toBe(1000);
    expect(parents.size).toBe(2);
  });

  it("returns an empty map for empty or malformed output", () => {
    expect(parseParentPids("").size).toBe(0);
    expect(parseParentPids("not,a\r\npid\r\n").size).toBe(0);
  });
});

describe("sweepStaleProcesses", () => {
  it("is a no-op on non-Windows platforms", async () => {
    const run = async () => "";
    const report = await sweepStaleProcesses({ platform: "darwin", run });
    expect(report).toEqual({
      skipped: true,
      killed: [],
      failed: [],
      skippedLiveParent: 0,
      fallback: false,
    });
  });

  it("kills orphaned rojo/opencode processes with /F /T on Windows", async () => {
    const commands: Array<{ file: string; args: readonly string[] }> = [];
    const run = async (file: string, args: readonly string[]) => {
      commands.push({ file, args });
      const joined = args.join(" ");
      if (file === "tasklist" && joined.includes("IMAGENAME eq rojo.exe")) {
        return '"rojo.exe","123","Console","1","1 K"\r\n';
      }
      if (file === "tasklist" && joined.includes("IMAGENAME eq opencode.exe")) {
        return '"opencode.exe","456","Console","1","1 K"\r\n';
      }
      if (file === "powershell.exe") {
        // Both candidates' parents (999, 1000) are dead.
        return "123,999\r\n456,1000\r\n";
      }
      if (file === "tasklist") {
        // Full process listing — neither 999 nor 1000 is alive.
        return '"System Idle Process","0","Services","0","8 K"\r\n"explorer.exe","777","Console","1","1 K"\r\n';
      }
      return "";
    };

    const report = await sweepStaleProcesses({ platform: "win32", run });

    expect(report.skipped).toBe(false);
    expect(report.fallback).toBe(false);
    expect(report.skippedLiveParent).toBe(0);
    expect(report.killed).toEqual([
      { image: "rojo.exe", pid: 123 },
      { image: "opencode.exe", pid: 456 },
    ]);
    expect(commands).toContainEqual({ file: "taskkill", args: ["/F", "/T", "/PID", "123"] });
    expect(commands).toContainEqual({ file: "taskkill", args: ["/F", "/T", "/PID", "456"] });
  });

  it("skips candidates whose parent process is still alive", async () => {
    const run = async (file: string, args: readonly string[]) => {
      const joined = args.join(" ");
      if (file === "tasklist" && joined.includes("IMAGENAME eq rojo.exe")) {
        return '"rojo.exe","123","Console","1","1 K"\r\n';
      }
      if (file === "tasklist" && joined.includes("IMAGENAME eq opencode.exe")) {
        return '"opencode.exe","456","Console","1","1 K"\r\n';
      }
      if (file === "powershell.exe") {
        // rojo's parent (777) is alive (user-launched); opencode's (999) is dead.
        return "123,777\r\n456,999\r\n";
      }
      if (file === "tasklist") {
        return '"explorer.exe","777","Console","1","1 K"\r\n';
      }
      return "";
    };

    const report = await sweepStaleProcesses({ platform: "win32", run });

    expect(report.killed).toEqual([{ image: "opencode.exe", pid: 456 }]);
    expect(report.failed).toEqual([]);
    expect(report.skippedLiveParent).toBe(1);
    expect(report.fallback).toBe(false);
  });

  it("falls back to name-based kills when parent discovery fails", async () => {
    const run = async (file: string, args: readonly string[]) => {
      const joined = args.join(" ");
      if (file === "tasklist" && joined.includes("IMAGENAME eq rojo.exe")) {
        return '"rojo.exe","123","Console","1","1 K"\r\n';
      }
      if (file === "tasklist" && joined.includes("IMAGENAME eq opencode.exe")) {
        return "";
      }
      if (file === "powershell.exe") {
        throw new Error("powershell unavailable");
      }
      return "";
    };

    const report = await sweepStaleProcesses({ platform: "win32", run });

    expect(report.fallback).toBe(true);
    expect(report.killed).toEqual([{ image: "rojo.exe", pid: 123 }]);
    expect(report.failed).toEqual([]);
    expect(report.skippedLiveParent).toBe(0);
  });

  it("records kill failures without throwing", async () => {
    const run = async (file: string, args: readonly string[]) => {
      const joined = args.join(" ");
      if (file === "tasklist" && joined.includes("IMAGENAME eq rojo.exe")) {
        return '"rojo.exe","123","Console","1","1 K"\r\n';
      }
      if (file === "tasklist") return "";
      throw new Error("access denied");
    };

    const report = await sweepStaleProcesses({ platform: "win32", run });

    expect(report.killed).toEqual([]);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]).toMatchObject({ image: "rojo.exe", pid: 123 });
  });

  it("skips an image whose listing fails and continues with the rest", async () => {
    const run = async (file: string, args: readonly string[]) => {
      const joined = args.join(" ");
      if (file === "tasklist" && joined.includes("IMAGENAME eq rojo.exe")) {
        throw new Error("tasklist unavailable");
      }
      if (file === "tasklist" && joined.includes("IMAGENAME eq opencode.exe")) {
        return '"opencode.exe","456","Console","1","1 K"\r\n';
      }
      if (file === "tasklist") return "";
      return "";
    };

    const report = await sweepStaleProcesses({ platform: "win32", run });

    expect(report.killed).toEqual([{ image: "opencode.exe", pid: 456 }]);
    expect(report.failed).toEqual([]);
  });

  it("does not query parents or kill anything when no candidates match", async () => {
    const commands: Array<{ file: string; args: readonly string[] }> = [];
    const run = async (file: string, args: readonly string[]) => {
      commands.push({ file, args });
      return "INFO: No tasks are running which match the specified criteria.\r\n";
    };

    const report = await sweepStaleProcesses({ platform: "win32", run });

    expect(report).toEqual({
      skipped: false,
      killed: [],
      failed: [],
      skippedLiveParent: 0,
      fallback: false,
    });
    expect(commands.some((command) => command.file === "powershell.exe")).toBe(false);
    expect(commands.some((command) => command.file === "taskkill")).toBe(false);
  });
});
