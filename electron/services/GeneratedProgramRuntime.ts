import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { Context, Data, Effect, Layer, Schema } from "effect";
import { transform } from "sucrase";

import {
  type GeneratedProgramArtifact,
  GeneratedProgramArtifactSchema,
  type GeneratedProgramEnvelope,
  GeneratedProgramEnvelopeSchema,
  type GeneratedProgramInvocation,
  GeneratedProgramInvocationSchema,
  type GeneratedProgramResult,
  GeneratedProgramResultSchema,
} from "../../src/types/generatedProgram";
import { StudioMcpBroker } from "./StudioMcpBroker";

type CallTool = (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;
type ProgramFunction = (input: unknown, callTool: CallTool) => Promise<unknown>;

export type GeneratedProgramFailurePhase = "compile" | "tool-contract" | "runtime" | "output";

export class GeneratedProgramRuntimeError extends Data.TaggedError("GeneratedProgramRuntimeError")<{
  message: string;
  phase: GeneratedProgramFailurePhase;
  regenerate: true;
  cause?: unknown;
}> {}

export interface GeneratedProgramRuntimeService {
  readonly compile: (
    envelope: GeneratedProgramEnvelope,
  ) => Effect.Effect<GeneratedProgramArtifact, GeneratedProgramRuntimeError>;
  readonly invoke: (
    invocation: GeneratedProgramInvocation,
  ) => Effect.Effect<GeneratedProgramResult, GeneratedProgramRuntimeError>;
}

export class GeneratedProgramRuntime extends Context.Tag("@BloxMind/GeneratedProgramRuntime")<
  GeneratedProgramRuntime,
  GeneratedProgramRuntimeService
>() {}

class ToolContractError extends Error {}

function runtimeError(phase: GeneratedProgramFailurePhase, message: string, cause: unknown) {
  const detail = cause instanceof Error && cause.message ? `: ${cause.message}` : "";
  return new GeneratedProgramRuntimeError({
    phase,
    message: `${message}${detail}`,
    regenerate: true,
    cause,
  });
}

function cacheKey(envelope: GeneratedProgramEnvelope): string {
  return createHash("sha256")
    .update(JSON.stringify(envelope.contract))
    .update("\0")
    .update(envelope.source)
    .digest("hex");
}

const WORKER_TIMEOUT_MS = 30_000;

type ProgramExecutor = (
  compiledSource: string,
  input: unknown,
  callTool: CallTool,
) => Promise<unknown>;

export function makeDirectExecutor(): ProgramExecutor {
  return async (compiledSource, input, callTool) => {
    const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
      ...args: string[]
    ) => ProgramFunction;
    const fn = new AsyncFunction(
      "input",
      "callTool",
      `"use strict";\n${compiledSource}\nif (typeof run !== "function") throw new Error("Generated program must define async function run({ input, callTool })");\nreturn await run({ input, callTool });`,
    );
    return await fn(input, callTool);
  };
}

function buildWorkerScript(compiledSource: string): string {
  return `
"use strict";

const runs = (() => {
  ${compiledSource}
  if (typeof run !== "function") {
    throw new Error("Generated program must define async function run({ input, callTool })");
  }
  return run;
})();

const { parentPort } = require("node:worker_threads");
if (!parentPort) throw new Error("Worker must be started with a MessagePort");

parentPort.on("message", async (message) => {
  if (!message || message.type !== "invoke") return;
  const { input } = message;
  let callToolIndex = 0;

  const callTool = async (name, args) => {
    const callId = callToolIndex++;
    parentPort.postMessage({ type: "callTool", id: callId, name, args });
    return await new Promise((resolve, reject) => {
      const handler = (msg) => {
        if (msg && msg.type === "callToolResult" && msg.id === callId) {
          parentPort.off("message", handler);
          if (msg.error) reject(new Error(msg.error));
          else resolve(msg.result);
        }
      };
      parentPort.on("message", handler);
    });
  };

  try {
    const result = await runs({ input, callTool });
    parentPort.postMessage({ type: "result", value: result });
  } catch (err) {
    parentPort.postMessage({
      type: "result",
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
`;
}

function makeWorkerExecutor(timeoutMs: number = WORKER_TIMEOUT_MS): ProgramExecutor {
  return async (compiledSource, input, callTool) => {
    const workerScript = buildWorkerScript(compiledSource);
    const tempDir = await mkdtemp(join(tmpdir(), "bloxmind-program-"));
    const scriptPath = join(tempDir, "program.js");
    await writeFile(scriptPath, workerScript, "utf8");

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.terminate();
        reject(new Error(`Program execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const worker = new Worker(scriptPath, {
        eval: false,
        workerData: undefined,
        execArgv: [],
      });

      worker.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      worker.on("exit", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`Worker exited with code ${code}`));
        }
      });

      worker.on(
        "message",
        async (message: {
          type: string;
          id?: number;
          name?: string;
          args?: Record<string, unknown>;
          result?: unknown;
          error?: string;
          value?: unknown;
        }) => {
          if (message.type === "callTool") {
            if (!message.name) {
              worker.postMessage({
                type: "callToolResult",
                id: message.id,
                error: "callTool message missing required 'name' field",
              });
              return;
            }
            try {
              const result = await callTool(message.name, message.args ?? {});
              worker.postMessage({ type: "callToolResult", id: message.id, result });
            } catch (err) {
              worker.postMessage({
                type: "callToolResult",
                id: message.id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          } else if (message.type === "result") {
            clearTimeout(timer);
            if (message.error) {
              reject(new Error(message.error));
            } else {
              resolve(message.value);
            }
            worker.terminate();
          }
        },
      );

      worker.postMessage({ type: "invoke", input });
    });
  };
}

export interface GeneratedProgramRuntimeOptions {
  executor?: ProgramExecutor;
}

export function startGeneratedProgramRuntime(
  callTool: CallTool,
  options: GeneratedProgramRuntimeOptions = {},
): GeneratedProgramRuntimeService {
  const executor = options.executor ?? makeWorkerExecutor();
  const artifacts = new Map<string, GeneratedProgramArtifact>();
  const compiledSources = new Map<string, string>();

  const compile = async (candidate: GeneratedProgramEnvelope) => {
    const envelope = await Schema.decodeUnknownPromise(GeneratedProgramEnvelopeSchema)(candidate);
    const key = cacheKey(envelope);
    const cached = artifacts.get(key);
    if (cached) return cached;
    if (/\b(?:import|export)\b/u.test(envelope.source)) {
      throw new Error("Generated programs must be import-free");
    }
    const compiledSource = transform(envelope.source, { transforms: ["typescript"] }).code;
    const artifact = await Schema.decodeUnknownPromise(GeneratedProgramArtifactSchema)({
      cacheKey: key,
      contract: envelope.contract,
      compiledSource,
    });
    compiledSources.set(key, compiledSource);
    artifacts.set(key, artifact);
    return artifact;
  };

  return {
    compile: (envelope) =>
      Effect.tryPromise({
        try: () => compile(envelope),
        catch: (cause) => runtimeError("compile", "Generated program did not compile", cause),
      }),
    invoke: (candidate) =>
      Effect.gen(function* () {
        const invocation = yield* Schema.decodeUnknown(GeneratedProgramInvocationSchema)(
          candidate,
        ).pipe(
          Effect.mapError((cause) =>
            runtimeError("runtime", "Generated program invocation is invalid", cause),
          ),
        );
        let compiledSource = compiledSources.get(invocation.artifact.cacheKey);
        if (!compiledSource) {
          compiledSource = invocation.artifact.compiledSource;
          compiledSources.set(invocation.artifact.cacheKey, compiledSource);
        }
        const guardedCallTool: CallTool = async (name, args) => {
          try {
            return await callTool(name, args);
          } catch (cause) {
            throw new ToolContractError(
              cause instanceof Error ? cause.message : "Studio MCP tool call failed",
            );
          }
        };
        const value = yield* Effect.tryPromise({
          try: () => executor(compiledSource, invocation.input, guardedCallTool),
          catch: (cause) =>
            cause instanceof ToolContractError
              ? runtimeError("tool-contract", "Generated program tool contract failed", cause)
              : runtimeError("runtime", "Generated program execution failed", cause),
        });
        const jsonValue = yield* Effect.try({
          try: () => {
            const json = JSON.stringify(value);
            if (json === undefined) throw new Error("Output is not JSON serializable");
            return JSON.parse(json) as unknown;
          },
          catch: (cause) => runtimeError("output", "Generated program output is invalid", cause),
        });
        return yield* Schema.decodeUnknown(GeneratedProgramResultSchema)({
          contract: invocation.artifact.contract,
          value: jsonValue,
        }).pipe(
          Effect.mapError((cause) =>
            runtimeError("output", "Generated program result schema failed", cause),
          ),
        );
      }),
  };
}

export const GeneratedProgramRuntimeLive = Layer.effect(
  GeneratedProgramRuntime,
  Effect.gen(function* () {
    const broker = yield* StudioMcpBroker;
    return startGeneratedProgramRuntime((name, args) =>
      Effect.runPromise(broker.callTool(name, args)),
    );
  }),
);
