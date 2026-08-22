import { transform } from "sucrase";
import { describe, expect, it } from "vitest";

import { BUILTIN_STUDIO_TARGET_PROGRAMS } from "@/lib/builtinStudioPrograms";

type CallTool = (name: string, args: Record<string, unknown>) => Promise<unknown>;

async function runProgram(source: string, input: unknown, callTool: CallTool) {
  const compiled = transform(source, { transforms: ["typescript"] }).code;
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
    ...args: string[]
  ) => (input: unknown, callTool: CallTool) => Promise<unknown>;
  const fn = new AsyncFunction(
    "input",
    "callTool",
    `${compiled}\nif (typeof run !== "function") throw new Error("no run");\nreturn await run({ input, callTool });`,
  );
  return fn(input, callTool);
}

const mcpResult = (payload: object | string, isError = false) => ({
  content: [
    { type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload) },
  ],
  isError,
});

const studios = [
  { id: "studio-a", name: "Place A" },
  { id: "studio-b", name: "Place B" },
];

describe("builtin studio target programs", () => {
  it("discovery lists studios and reports Studio-side errors", async () => {
    const discovery = BUILTIN_STUDIO_TARGET_PROGRAMS.discovery.source;
    await expect(runProgram(discovery, {}, async () => mcpResult({ studios }))).resolves.toEqual({
      targets: [
        { key: "studio-a", label: "Place A", detail: null },
        { key: "studio-b", label: "Place B", detail: null },
      ],
      selectedKey: null,
      error: null,
    });

    await expect(
      runProgram(discovery, {}, async () =>
        mcpResult("Unable to reach Roblox Studio right now.", true),
      ),
    ).resolves.toMatchObject({
      targets: [],
      selectedKey: null,
      error: "Unable to reach Roblox Studio right now.",
    });
  });

  it("selection verifies the target against a fresh listing", async () => {
    const selection = BUILTIN_STUDIO_TARGET_PROGRAMS.selection.source;
    let listCalls = 0;
    const result = await runProgram(selection, { targetKey: "studio-b" }, async (name) => {
      expect(name).toBe("list_roblox_studios");
      listCalls += 1;
      return mcpResult({ studios });
    });
    expect(listCalls).toBe(1);
    expect(result).toEqual({
      selected: { key: "studio-b", label: "Place B", detail: null },
      verified: true,
    });
  });

  it("selection throws when the id rotated away or Studio rejects the call", async () => {
    const selection = BUILTIN_STUDIO_TARGET_PROGRAMS.selection.source;
    await expect(
      runProgram(selection, { targetKey: "stale-id" }, async () => mcpResult({ studios })),
    ).rejects.toThrow("Studio target could not be verified");

    await expect(
      runProgram(selection, { targetKey: "studio-a" }, async () =>
        mcpResult("Unable to reach Roblox Studio right now.", true),
      ),
    ).rejects.toThrow("Roblox Studio rejected the selection request");
  });

  it("selection requires a target key", async () => {
    await expect(
      runProgram(BUILTIN_STUDIO_TARGET_PROGRAMS.selection.source, {}, async () =>
        mcpResult({ studios }),
      ),
    ).rejects.toThrow("A Studio target is required");
  });
});
