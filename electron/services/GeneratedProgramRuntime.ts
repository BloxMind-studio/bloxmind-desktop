import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Worker } from "node:worker_threads";

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
import {
  allowedBloxBotProgramTools,
  isBloxBotProgramContract,
  isKnownBloxBotProgramTool,
  isReadOnlyStudioTool,
  knownBloxBotProgramTools,
  type StudioToolAnnotations,
  studioToolName,
} from "../../src/lib/bloxbotProgramManifest";
import { StudioMcpBroker } from "./StudioMcpBroker";

export type CallTool = (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;
/** Studio's annotations for a tool, or undefined when Studio doesn't list it. */
export type DescribeTool = (
  name: string,
) => Promise<{ annotations?: StudioToolAnnotations } | undefined>;
/** The tools Studio lists now, with their annotations. */
export type ListTools = () => Promise<
  readonly { name: string; annotations?: StudioToolAnnotations }[]
>;

export type GeneratedProgramFailurePhase =
  | "compile"
  | "tool-contract"
  | "runtime"
  | "output";

export class GeneratedProgramRuntimeError extends Data.TaggedError(
  "GeneratedProgramRuntimeError",
)<{
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
  /**
   * The tools a program may call, by Studio's own name: those Studio lists now
   * that the allow rule accepts, or the program's known tools when Studio
   * lists none.
   */
  readonly allowedTools: (program: string) => Effect.Effect<string[]>;
}

export class GeneratedProgramRuntime extends Context.Tag("@BloxMind/GeneratedProgramRuntime")<
  GeneratedProgramRuntime,
  GeneratedProgramRuntimeService
>() {}

const TOOL_LIST_TTL_MS = 30_000;

function runtimeError(
  phase: GeneratedProgramFailurePhase,
  message: string,
  cause: unknown,
) {
  return new GeneratedProgramRuntimeError({ phase, message, regenerate: true, cause });
}

function withCause(message: string, cause: unknown): string {
  return cause instanceof Error && cause.message ? `${message}: ${cause.message}` : message;
}

function cacheKey(envelope: GeneratedProgramEnvelope): string {
  return createHash("sha256")
    .update(JSON.stringify(envelope.contract))
    .update("\0")
    .update(envelope.source)
    .digest("hex");
}

// Per-process signing key. Only artifacts this process compiled can be
// executed from their source; anything restored across a restart fails
// verification and must be recompiled, which callers handle by regenerating.
const artifactSigningKey = randomBytes(32);

type SignableArtifact = Pick<
  GeneratedProgramArtifact,
  "cacheKey" | "contract" | "compiledSource"
>;

/** Deterministic HMAC over the executable parts of a compiled artifact. */
export function generatedProgramSignature(artifact: SignableArtifact): string {
  const { contract } = artifact;
  return createHmac("sha256", artifactSigningKey)
    .update(artifact.cacheKey)
    .update("\0")
    .update(contract.name)
    .update("\0")
    .update(contract.version)
    .update("\0")
    .update(contract.inputSchemaVersion)
    .update("\0")
    .update(contract.outputSchemaVersion)
    .update("\0")
    .update(artifact.compiledSource)
    .digest("hex");
}

function hasValidSignature(artifact: GeneratedProgramArtifact): boolean {
  if (typeof artifact.signature !== "string") return false;
  const expected = Buffer.from(generatedProgramSignature(artifact), "hex");
  const provided = Buffer.from(artifact.signature, "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

// ── Sandboxed execution ─────────────────────────────────────────────────
//
// Model-authored programs used to be compiled with `new AsyncFunction` and run
// in the main process, where `process.getBuiltinModule("node:fs")` reached the
// user's filesystem and a stray infinite loop froze the whole app. Each run now
// happens on a throwaway worker thread inside a fresh `vm` context with code
// generation disabled and no `process`, `require`, or host objects exposed.
//
// This is substantial isolation, not a formal security boundary: Node's `vm`
// module is not a supported sandbox, so a determined escape may still be
// possible. The thread separation and the hard timeout always hold, and the
// program never runs with the main process's globals by default.

const PROGRAM_TIMEOUT_MS = 60_000;
const MAX_COMPILED_PROGRAMS = 64;

type ToolCallOutcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly contract: boolean; readonly message: string };

/** A worker failure that already knows how the program failed. */
class ProgramWorkerError extends Error {
  constructor(
    message: string,
    readonly phase: "runtime" | "output",
  ) {
    super(message);
    this.name = "ProgramWorkerError";
  }
}

interface ProgramWorkerOptions {
  compiledSource: string;
  input: unknown;
  timeoutMs: number;
  onToolCall: (name: string, args: Record<string, unknown>) => Promise<ToolCallOutcome>;
}

// Runs as CommonJS in a worker thread (`eval: true`), so `require` is the
// worker's own loader rather than anything the generated program can reach.
const PROGRAM_WORKER_SOURCE = String.raw`
const { parentPort } = require("node:worker_threads");
const vm = require("node:vm");

let nextId = 1;
const pending = new Map();

function bridge(requestJson) {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    parentPort.postMessage({ type: "tool", id, requestJson });
  });
}

// Runs inside the sandbox. The bridge is captured in this closure and removed
// from the globals before any program code runs, and responses cross the
// boundary as JSON strings so no host-realm object is ever exposed (a host
// object's .constructor would leak the real Function constructor).
const BOOTSTRAP = [
  '"use strict";',
  "const __bridge = globalThis.__bridge;",
  "delete globalThis.__bridge;",
  "globalThis.console = Object.freeze({ log() {}, info() {}, warn() {}, error() {}, debug() {} });",
  "globalThis.callTool = async (name, args) => {",
  "  const response = JSON.parse(await __bridge(JSON.stringify([name, args === undefined ? {} : args])));",
  "  if (!response || response.ok !== true) {",
  '    const error = new Error(String((response && response.message) || "Studio tool call failed"));',
  '    error.name = response && response.contract ? "ToolContractError" : "Error";',
  "    throw error;",
  "  }",
  "  return response.value;",
  "};",
].join("\n");

async function execute(message) {
  try {
    const context = vm.createContext(
      // A null prototype matters: with a plain empty object the context
      // global inherits the host's Object.prototype, so globalThis.constructor
      // .constructor is the real Function constructor and the sandbox is
      // gone in one line.
      Object.create(null),
      { codeGeneration: { strings: false, wasm: false } },
    );
    context.__bridge = bridge;
    vm.runInContext(BOOTSTRAP, context);
    context.__inputJson = message.inputJson;
    const wrapped = [
      "(async () => {",
      '"use strict";',
      "const input = JSON.parse(globalThis.__inputJson);",
      "delete globalThis.__inputJson;",
      message.compiledSource,
      'if (typeof run !== "function") throw new Error("Generated program must define async function run({ input, callTool })");',
      "return await run({ input, callTool: globalThis.callTool });",
      "})()",
    ].join("\n");
    const value = await vm.runInContext(wrapped, context, { filename: "generated-program.js" });
    const valueJson = JSON.stringify(value);
    if (valueJson === undefined) throw new Error("Output is not JSON serializable");
    parentPort.postMessage({ type: "result", valueJson });
  } catch (cause) {
    // Errors thrown inside the vm belong to another realm, so instanceof
    // Error is false here; read the message structurally instead.
    const message =
      cause && typeof cause === "object" && typeof cause.message === "string"
        ? cause.message
        : String(cause);
    const serializationFailure = message === "Output is not JSON serializable";
    parentPort.postMessage({
      type: "error",
      message,
      phase: serializationFailure ? "output" : "runtime",
    });
  }
}

parentPort.on("message", (message) => {
  if (message && message.type === "tool-result") {
    const resolve = pending.get(message.id);
    pending.delete(message.id);
    if (resolve) resolve(String(message.payload));
    return;
  }
  if (message && message.type === "run") void execute(message);
});
`;

function runProgramInWorker(options: ProgramWorkerOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(PROGRAM_WORKER_SOURCE, {
        eval: true,
        resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 48 },
        stdout: true,
        stderr: true,
      });
    } catch (cause) {
      reject(new ProgramWorkerError(withCause("Generated program worker failed to start", cause), "runtime"));
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      settle(
        new ProgramWorkerError(
          `Generated program exceeded the ${Math.round(options.timeoutMs / 1000)}s limit`,
          "runtime",
        ),
      );
    }, options.timeoutMs);

    function settle(error?: Error, valueJson?: string) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeAllListeners();
      void worker.terminate().catch(() => undefined);
      if (error) reject(error);
      else resolve(valueJson ?? "");
    }

    const handleToolCall = (record: Record<string, unknown>) => {
      const id = record.id;
      const requestJson = record.requestJson;
      if (typeof id !== "number" || typeof requestJson !== "string") return;
      void (async () => {
        let outcome: ToolCallOutcome;
        try {
          const parsed = JSON.parse(requestJson) as unknown;
          const [rawName, rawArgs] = Array.isArray(parsed) ? parsed : [];
          if (typeof rawName !== "string") {
            throw new Error("Generated program requested an invalid tool");
          }
          const args =
            rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
              ? (rawArgs as Record<string, unknown>)
              : {};
          outcome = await options.onToolCall(rawName, args);
        } catch (cause) {
          outcome = {
            ok: false,
            contract: false,
            message: withCause("Studio tool call failed", cause),
          };
        }
        if (settled) return;
        let payload: string;
        try {
          payload = JSON.stringify(outcome);
        } catch (cause) {
          payload = JSON.stringify({
            ok: false,
            contract: false,
            message: withCause("Studio tool returned an unserializable result", cause),
          });
        }
        try {
          worker.postMessage({ type: "tool-result", id, payload });
        } catch {
          // The worker was terminated while the tool was in flight.
        }
      })();
    };

    worker.on("message", (message: unknown) => {
      if (!message || typeof message !== "object") return;
      const record = message as Record<string, unknown>;
      if (record.type === "tool") {
        handleToolCall(record);
      } else if (record.type === "result" && typeof record.valueJson === "string") {
        settle(undefined, record.valueJson);
      } else if (record.type === "error") {
        settle(
          new ProgramWorkerError(
            typeof record.message === "string" ? record.message : "Generated program failed",
            record.phase === "output" ? "output" : "runtime",
          ),
        );
      }
    });
    worker.on("error", (cause) =>
      settle(
        new ProgramWorkerError(withCause("Generated program worker failed", cause), "runtime"),
      ),
    );
    worker.on("exit", (code) =>
      settle(new ProgramWorkerError(`Generated program worker exited with code ${code}`, "runtime")),
    );
    // Keep the worker's output from filling a pipe nobody reads.
    worker.stdout?.resume();
    worker.stderr?.resume();
    worker.postMessage({
      type: "run",
      compiledSource: options.compiledSource,
      inputJson: JSON.stringify(options.input ?? null),
    });
  });
}

export interface GeneratedProgramRuntimeOptions {
  /** Hard limit for a single invocation. Defaults to 60 seconds. */
  timeoutMs?: number;
}

export function startGeneratedProgramRuntime(
  callTool: CallTool,
  describeTool: DescribeTool = async () => undefined,
  listTools: ListTools = async () => [],
  options: GeneratedProgramRuntimeOptions = {},
): GeneratedProgramRuntimeService {
  const artifacts = new Map<string, GeneratedProgramArtifact>();
  const timeoutMs = options.timeoutMs ?? PROGRAM_TIMEOUT_MS;

  const remember = (key: string, artifact: GeneratedProgramArtifact) => {
    // Re-insert so the oldest entry is evicted first, and keep the cache
    // bounded: compiled sources are otherwise never released.
    artifacts.delete(key);
    artifacts.set(key, artifact);
    while (artifacts.size > MAX_COMPILED_PROGRAMS) {
      const oldest = artifacts.keys().next().value;
      if (oldest === undefined) break;
      artifacts.delete(oldest);
    }
  };

  const compile = async (candidate: GeneratedProgramEnvelope) => {
    const envelope = await Schema.decodeUnknownPromise(GeneratedProgramEnvelopeSchema)(candidate);
    const key = cacheKey(envelope);
    const cached = artifacts.get(key);
    if (cached) return cached;
    if (/\b(?:import|export)\b/u.test(envelope.source)) {
      throw new Error("Generated programs must be import-free");
    }
    const compiledSource = transform(envelope.source, { transforms: ["typescript"] }).code;
    const signature = generatedProgramSignature({
      cacheKey: key,
      contract: envelope.contract,
      compiledSource,
    });
    const artifact = await Schema.decodeUnknownPromise(GeneratedProgramArtifactSchema)({
      cacheKey: key,
      contract: envelope.contract,
      compiledSource,
      signature,
    });
    remember(key, artifact);
    return artifact;
  };

  return {
    allowedTools: (program) =>
      Effect.promise(async () => {
        const listed = await listTools().catch(() => []);
        return listed.length > 0
          ? allowedBloxBotProgramTools(program, listed).map((tool) => tool.name)
          : [...knownBloxBotProgramTools(program)];
      }),
    compile: (envelope) =>
      Effect.tryPromise({
        try: () => compile(envelope),
        catch: (cause) =>
          runtimeError("compile", withCause("Generated program did not compile", cause), cause),
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
        // Verify the HMAC over the executable fields before trusting any part
        // of the artifact: the renderer can echo back a tampered object.
        if (!hasValidSignature(invocation.artifact)) {
          return yield* Effect.fail(
            runtimeError(
              "compile",
              "Compiled program was not signed by this session; recompile it before invoking",
              undefined,
            ),
          );
        }
        // Prefer the source this process compiled over the copy that came
        // back over IPC, even though the signature already covers it.
        const compiledSource =
          artifacts.get(invocation.artifact.cacheKey)?.compiledSource ??
          invocation.artifact.compiledSource;
        const contractName = invocation.artifact.contract.name;
        let toolContractFailed = false;

        const guardedCallTool = async (
          requestedName: string,
          args: Record<string, unknown>,
        ): Promise<ToolCallOutcome> => {
          // A model-written program may use OpenCode's name for a tool
          // (roblox-studio_search_game_tree). The rule below and Studio both
          // see Studio's own name, so the prefix never changes what's allowed.
          const name = studioToolName(requestedName);
          // Programs may only read from Studio, whoever wrote them.
          let allowed = false;
          try {
            allowed =
              isKnownBloxBotProgramTool(contractName, name) ||
              (isBloxBotProgramContract(contractName) &&
                isReadOnlyStudioTool((await describeTool(name))?.annotations));
          } catch (cause) {
            toolContractFailed = true;
            return {
              ok: false,
              contract: true,
              message: withCause(`Could not check whether ${name} is read-only`, cause),
            };
          }
          if (!allowed) {
            toolContractFailed = true;
            return {
              ok: false,
              contract: true,
              message: `${contractName} programs may not call ${requestedName}`,
            };
          }
          try {
            return { ok: true, value: await callTool(name, args) };
          } catch (cause) {
            // Keep the program's own message (such as Studio's error text) in
            // the message itself, since only the message crosses the bridge.
            toolContractFailed = true;
            return {
              ok: false,
              contract: true,
              message: cause instanceof Error ? cause.message : "Studio MCP tool call failed",
            };
          }
        };

        const valueJson = yield* Effect.tryPromise({
          try: () =>
            runProgramInWorker({
              compiledSource,
              input: invocation.input,
              timeoutMs,
              onToolCall: guardedCallTool,
            }),
          catch: (cause) => {
            const workerPhase = cause instanceof ProgramWorkerError ? cause.phase : "runtime";
            const phase: GeneratedProgramFailurePhase =
              workerPhase === "output" ? "output" : toolContractFailed ? "tool-contract" : "runtime";
            const message =
              phase === "output"
                ? "Generated program output is invalid"
                : phase === "tool-contract"
                  ? "Generated program tool contract failed"
                  : "Generated program execution failed";
            return runtimeError(phase, withCause(message, cause), cause);
          },
        });

        const jsonValue = yield* Effect.try({
          try: () => JSON.parse(valueJson) as unknown,
          catch: (cause) =>
            runtimeError("output", withCause("Generated program output is invalid", cause), cause),
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
    // Studio's tool list, reused briefly so a looping program can't flood Studio
    // with list requests, and refreshed often enough that changed annotations or
    // renamed tools apply within seconds.
    let cached: {
      tools: Map<string, { name: string; annotations?: StudioToolAnnotations }>;
      at: number;
    } | null = null;
    const listTools = async () => {
      if (!cached || Date.now() - cached.at > TOOL_LIST_TTL_MS) {
        const listed = await Effect.runPromise(broker.listTools);
        cached = { tools: new Map(listed.map((tool) => [tool.name, tool])), at: Date.now() };
      }
      return cached.tools;
    };
    return startGeneratedProgramRuntime(
      (name, args) => Effect.runPromise(broker.callTool(name, args)),
      async (name) => {
        try {
          return (await listTools()).get(name);
        } catch {
          return undefined;
        }
      },
      async () => [...(await listTools()).values()],
    );
  }),
);
