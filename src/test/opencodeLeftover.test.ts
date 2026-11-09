import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ProcessTable,
  parseCreationDate,
  parseEtimes,
  stopLeftoverOpenCode,
} from "../../electron/services/openCodeLeftover";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "bloxmind-leftover-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const pidFile = () => join(root, "server.pid");

describe("process start-time parsing", () => {
  it("parses ps etimes in seconds", () => {
    expect(parseEtimes("  3710\n")).toBe(3710);
    expect(parseEtimes("garbage")).toBeNull();
  });

  it("parses the Windows CreationDate format", () => {
    const parsed = parseCreationDate("2026-11-09T14:22:10\n");
    expect(parsed).toBe(new Date(2026, 10, 9, 14, 22, 10).getTime());
    expect(parseCreationDate("not a date")).toBeNull();
  });
});

function fakeTable(overrides: Partial<ProcessTable> = {}): ProcessTable {
  return {
    name: vi.fn(async () => "opencode.exe"),
    alive: vi.fn(() => false),
    kill: vi.fn(),
    created: vi.fn(async () => Date.now()),
    ...overrides,
  };
}

describe("stopLeftoverOpenCode", () => {
  it("kills a recorded process whose name and start time match", async () => {
    const start = Date.now();
    await writeFile(pidFile(), JSON.stringify({ pid: 4242, name: "opencode.exe", created: start }));
    const table = fakeTable({ created: vi.fn(async () => start + 5_000) });

    const result = await stopLeftoverOpenCode(pidFile(), table, 100);

    expect(result).toBe(4242);
    expect(table.kill).toHaveBeenCalledWith(4242);
    await expect(readFile(pidFile(), "utf8")).rejects.toThrow();
  });

  it("leaves a pid that was recycled into a different process alone", async () => {
    const longAgo = Date.now() - 3 * 60 * 60 * 1000;
    await writeFile(
      pidFile(),
      JSON.stringify({ pid: 4242, name: "opencode.exe", created: longAgo }),
    );
    const table = fakeTable({ created: vi.fn(async () => Date.now()) });

    const result = await stopLeftoverOpenCode(pidFile(), table, 100);

    expect(result).toBeNull();
    expect(table.kill).not.toHaveBeenCalled();
  });

  it("leaves a process whose name no longer matches", async () => {
    await writeFile(
      pidFile(),
      JSON.stringify({ pid: 4242, name: "opencode.exe", created: Date.now() }),
    );
    const table = fakeTable({ name: vi.fn(async () => "other.exe") });

    const result = await stopLeftoverOpenCode(pidFile(), table, 100);

    expect(result).toBeNull();
    expect(table.kill).not.toHaveBeenCalled();
  });

  it("still cleans up when the start time is unavailable", async () => {
    await writeFile(
      pidFile(),
      JSON.stringify({ pid: 4242, name: "opencode.exe", created: Date.now() }),
    );
    const table = fakeTable({ created: vi.fn(async () => null) });

    const result = await stopLeftoverOpenCode(pidFile(), table, 100);

    expect(result).toBe(4242);
    expect(table.kill).toHaveBeenCalledWith(4242);
  });
});
