import * as OC from "@opencode/client/promise";
import { normalizeExecutionError, normalizePermissionRequest } from "../oc2Normalize";
import { buildOc2FormAnswer, translateOc2Form } from "./forms";
import { translateOc2AuthMethods, translateOc2ProviderList, unwrapList } from "./providers";
import type { PermissionRequest, QuestionRequest, Session } from "./types";

export type V1Options = { throwOnError?: boolean; signal?: AbortSignal; [key: string]: unknown };

/** Normalize OC2 direct-promise results to OC1 `{ data }` shape when `throwOnError` is used. */
async function v1<T>(promise: Promise<T>, _opts?: V1Options): Promise<{ data: T }> {
  const data = await promise;
  return { data };
}

function translateOc2ToolState(state: any): any {
  if (!state || typeof state !== "object") return { status: "pending", input: {}, raw: "" };
  const status = state.status;
  if (status === "completed") {
    const content = Array.isArray(state.content) ? state.content : [];
    const text = content
      .map((c: any) => (c?.type === "text" ? c.text : ""))
      .filter(Boolean)
      .join("\n");
    return {
      status: "completed",
      input: state.input ?? {},
      output: text,
      title: state.metadata?.title ?? "",
      metadata: state.metadata ?? {},
      time: state.time ?? {},
    };
  }
  if (status === "error") {
    return {
      status: "error",
      input: state.input ?? {},
      error: state.error?.message ?? state.error?.type ?? "Tool failed",
      metadata: state.metadata ?? {},
      time: state.time ?? {},
    };
  }
  if (status === "running" || status === "streaming") {
    return {
      status: "running",
      input: state.input ?? {},
      metadata: state.metadata ?? {},
      time: state.time ?? {},
    };
  }
  return { status: "pending", input: state.input ?? {}, raw: state.raw ?? "" };
}

export function translateOc2FilePart(file: any): {
  type: "file";
  mime: string;
  url?: string;
  filename?: string;
} {
  const mime = typeof file?.mime === "string" && file.mime ? file.mime : "application/octet-stream";
  const filename =
    typeof file?.name === "string" && file.name
      ? file.name
      : typeof file?.filename === "string" && file.filename
        ? file.filename
        : undefined;
  const source = file?.source;
  // OC2 inline files carry base64 in `data`; uri files carry the URL in source.uri.
  let url =
    source?.type === "inline" && typeof file?.data === "string" && file.data
      ? `data:${mime};base64,${file.data}`
      : source?.type === "uri" && typeof source.uri === "string"
        ? source.uri
        : typeof file?.uri === "string"
          ? file.uri
          : typeof file?.url === "string"
            ? file.url
            : undefined;
  // A raw base64 payload with no source discriminator still deserves a URL.
  if (!url && typeof file?.data === "string" && file.data) {
    url = `data:${mime};base64,${file.data}`;
  }
  return {
    type: "file",
    mime,
    ...(url ? { url } : {}),
    ...(filename ? { filename } : {}),
  };
}

export function translateOc2Message(sessionID: string, m: any): { info: any; parts: any[] } {
  if (m && m.info && Array.isArray(m.parts)) return m;
  const type = m?.type ?? m?.info?.role ?? "assistant";
  const role = type === "user" ? "user" : type === "assistant" ? "assistant" : type;
  const info: any = {
    ...(m?.info && typeof m.info === "object" ? m.info : {}),
    ...m,
    id: m?.id ?? m?.info?.id,
    sessionID: m?.sessionID ?? m?.info?.sessionID ?? sessionID,
    role: m?.info?.role ?? (role === "user" || role === "assistant" ? role : "assistant"),
    time: m?.time ?? m?.info?.time ?? { created: Date.now() },
  };
  if (info.model && typeof info.model === "object") {
    info.providerID = info.providerID ?? info.model.providerID;
    info.modelID = info.modelID ?? info.model.id ?? info.model.modelID;
  }
  const parts: any[] = [];
  const messageID = info.id;
  const pushPart = (part: any) => {
    parts.push({ ...part, id: part.id ?? `${messageID}:${parts.length}`, sessionID, messageID });
  };
  if (Array.isArray(m?.parts)) return { info, parts: m.parts };
  if (role === "user" || type === "user") {
    if (typeof m?.text === "string" && m.text) pushPart({ type: "text", text: m.text });
    for (const f of Array.isArray(m?.files) ? m.files : []) {
      pushPart(translateOc2FilePart(f));
    }
  } else if (Array.isArray(m?.content)) {
    for (const c of m.content) {
      if (!c) continue;
      if (c.type === "text") pushPart({ type: "text", text: c.text ?? "" });
      else if (c.type === "reasoning")
        pushPart({ type: "reasoning", text: c.text ?? "", time: c.time });
      else if (c.type === "tool")
        pushPart({
          type: "tool",
          tool: c.name,
          callID: c.id,
          state: translateOc2ToolState(c.state),
        });
    }
  } else if (typeof m?.text === "string") {
    pushPart({ type: "text", text: m.text });
  }
  delete info.content;
  delete info.files;
  delete info.text;
  // OC1 error cards read error.name/error.data; OC2 SessionStructuredError has neither.
  if (info.error && info.role === "assistant") {
    const normalized = normalizeExecutionError(info.error);
    if (normalized) info.error = normalized;
  }
  return { info, parts };
}

function normalizeOc2Model(
  model: unknown,
): { providerID: string; id: string; variant?: string } | null {
  if (!model || typeof model !== "object") return null;
  const m = model as Record<string, unknown>;
  const providerID = typeof m.providerID === "string" ? m.providerID : undefined;
  const id =
    typeof m.id === "string" ? m.id : typeof m.modelID === "string" ? m.modelID : undefined;
  if (!providerID || !id) return null;
  const variant = typeof m.variant === "string" ? m.variant : undefined;
  return { providerID, id, ...(variant ? { variant } : {}) };
}

/**
 * Translate BloxMind's OC1 prompt payload to OC2 `SessionPromptInput`.
 * - `parts` (text/file) -> `text` + `files` (data URLs passed as URIs)
 * - `system` -> prepended to text as delimited context (OC2 prompt has no system field; preserves BloxMind safety/verification notes)
 * - `model`/`agent`/`variant` -> OC2 session.switchModel/switchAgent before prompt
 */
async function translateOc1Prompt(
  oc2: ReturnType<typeof OC.OpenCode.make>,
  directory: string | undefined,
  input: Record<string, unknown>,
  opts?: V1Options,
): Promise<Record<string, unknown>> {
  const sessionID = input.sessionID as string;
  const parts = Array.isArray(input.parts) ? (input.parts as Array<Record<string, unknown>>) : null;

  if (!parts && typeof input.text === "string") {
    // Already OC2-shaped enough; still handle model/agent switching if present.
    await applyOc1Selection(oc2, directory, sessionID, input, opts);
    return withDirectory(directory, input) as Record<string, unknown>;
  }

  const textParts: string[] = [];
  const files: Array<{ uri: string; name?: string; source?: { type: "inline" } }> = [];
  for (const part of parts ?? []) {
    if (part?.type === "text" && typeof part.text === "string") textParts.push(part.text);
    else if (part?.type === "file" && typeof part.url === "string") {
      const file: { uri: string; name?: string; source?: { type: "inline" } } = { uri: part.url };
      if (typeof part.filename === "string") file.name = part.filename;
      if (part.url.startsWith("data:")) file.source = { type: "inline" };
      files.push(file);
    }
  }

  const userText = textParts.join("\n\n").trim();
  const systemNotes: string[] = [];
  const system = typeof input.system === "string" ? input.system.trim() : "";
  if (system) systemNotes.push(`[System context for this request]\n${system}`);
  // OC2's prompt API has no `format`, so carry structured-output schemas as an
  // explicit instruction instead of silently dropping them (hidden sessions
  // such as playtest planning/explorer rely on JSON responses).
  const format = input.format as
    | { type?: string; schema?: unknown; retryCount?: number }
    | undefined;
  if (format?.type === "json_schema" && format.schema) {
    systemNotes.push(
      `[Structured output required]\nReturn only a single JSON value that validates against this JSON Schema. Do not wrap it in markdown fences or add commentary.\n${JSON.stringify(format.schema)}`,
    );
  }
  const text = systemNotes.length
    ? `${systemNotes.join("\n\n")}\n\n[User request]\n${userText || "(see attached files)"}`
    : userText;

  if (!input.noReply) {
    await applyOc1Selection(oc2, directory, sessionID, input, opts);
  }

  const out: Record<string, unknown> = { sessionID, text: text || " " };
  if (files.length) out.files = files;
  if (typeof input.id === "string") out.id = input.id;
  if (input.metadata && typeof input.metadata === "object") out.metadata = input.metadata;
  if (input.noReply) out.__noReply = true;
  return withDirectory(directory, out) as Record<string, unknown>;
}

async function applyOc1Selection(
  oc2: ReturnType<typeof OC.OpenCode.make>,
  directory: string | undefined,
  sessionID: string,
  input: Record<string, unknown>,
  opts?: V1Options,
) {
  if (!sessionID) return;
  const agent = typeof input.agent === "string" ? input.agent : undefined;
  if (agent) {
    await oc2.session.switchAgent(withDirectory(directory, { sessionID, agent }) as never, {
      signal: opts?.signal,
    });
  }
  const model = normalizeOc2Model(input.model);
  const variant = typeof input.variant === "string" ? input.variant : undefined;
  if (model) {
    await oc2.session.switchModel(
      withDirectory(directory, {
        sessionID,
        model: variant && !model.variant ? { ...model, variant } : model,
      }) as never,
      { signal: opts?.signal },
    );
  }
}

async function translateOc1Command(
  oc2: ReturnType<typeof OC.OpenCode.make>,
  directory: string | undefined,
  input: Record<string, unknown>,
  opts?: V1Options,
): Promise<Record<string, unknown>> {
  const sessionID = input.sessionID as string;
  await applyOc1Selection(oc2, directory, sessionID, input, opts);
  if (typeof input.name === "string") {
    return withDirectory(directory, input) as Record<string, unknown>;
  }
  // OC1 command shape fallback: { command, arguments } -> OC2 { name, text }
  const name = typeof input.command === "string" ? input.command : String(input.name ?? "");
  const text =
    typeof input.arguments === "string"
      ? input.arguments
      : typeof input.text === "string"
        ? input.text
        : "";
  const out: Record<string, unknown> = { sessionID, name, text };
  if (Array.isArray(input.files)) out.files = input.files;
  return withDirectory(directory, out) as Record<string, unknown>;
}

export interface OpencodeClientConfig {
  baseUrl: string;
  directory?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

// Explicit surface for the OC1-shaped client BloxMind consumes.
// biome-ignore lint/suspicious/noExplicitAny: OC1→OC2 compatibility boundary; full surface remapped in Steps 4-6
export type OpencodeClient = any;

function withDirectory<T extends Record<string, unknown> | undefined>(
  directory: string | undefined,
  input: T,
): T {
  if (!directory || !input || typeof input !== "object") return input;
  if ("directory" in input || "location" in input) return input;
  return { ...input, directory } as T;
}

/**
 * OC2 (`@opencode/client`) compatibility adapter exposing the OC1-shaped client
 * surface BloxMind uses. It wraps `OpenCode.make()` and normalizes responses to
 * `{ data }` for `throwOnError` callers, adapts SSE, and maps renamed methods.
 */
export function createOpencodeClient(config: OpencodeClientConfig): OpencodeClient {
  const make = (OC as { OpenCode: { make: typeof OC.OpenCode.make } }).OpenCode.make;
  const oc2 = make({
    baseUrl: config.baseUrl,
    headers: config.headers,
    fetch: config.fetch,
  }) as ReturnType<typeof OC.OpenCode.make>;
  const dir = config.directory;

  /** OC2 credentials reference an integration id; map the OC1 provider id to it. */
  const resolveIntegrationID = async (providerID: string, opts?: V1Options): Promise<string> => {
    try {
      const res = await oc2.provider.get(
        withDirectory(dir, { providerID }) as never,
        { signal: opts?.signal } as never,
      );
      const info = (res as { data?: unknown })?.data ?? res;
      if (info && typeof info === "object" && typeof (info as any).integrationID === "string") {
        return (info as any).integrationID;
      }
    } catch {
      // Fall back to the provider id; many integrations share the same id.
    }
    return providerID;
  };

  const oauthAttempts = new Map<string, { integrationID: string; attemptID: string }>();

  /** Fetch the newest assistant message in OC1 `{ info, parts }` form. */
  const latestAssistantMessage = async (
    sessionID: string,
    opts?: V1Options,
  ): Promise<{ info: any; parts: any[] } | null> => {
    try {
      const res = await oc2.message.list(
        withDirectory(dir, { sessionID }) as any,
        { signal: opts?.signal } as any,
      );
      const raw = (res as any)?.data ?? res;
      const items = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
      for (let index = items.length - 1; index >= 0; index--) {
        if (items[index]?.type === "assistant") {
          return translateOc2Message(sessionID, items[index]);
        }
      }
    } catch {
      // Fall through to the empty result below.
    }
    return null;
  };

  /**
   * OC2 `session.prompt` only enqueues the user message; OC1 `session.prompt`
   * resolved with the finished assistant message. Wait for idle, then read it.
   */
  const waitForTurn = async (sessionID: string, opts?: V1Options): Promise<void> => {
    const wait = (
      oc2.session as unknown as {
        wait?: (input: unknown, options?: unknown) => Promise<unknown>;
      }
    ).wait;
    if (typeof wait !== "function") return;
    const timeoutMs =
      typeof (opts as { timeoutMs?: number } | undefined)?.timeoutMs === "number"
        ? (opts as { timeoutMs: number }).timeoutMs
        : 10 * 60_000;
    try {
      await wait({ sessionID }, { signal: opts?.signal ?? AbortSignal.timeout(timeoutMs) });
    } catch {
      // Interrupted/aborted turns and timeout still resolve through the fallback read.
    }
  };

  const client = {
    session: {
      messages: async (input: { sessionID: string }, opts?: V1Options) => {
        const res = await oc2.message.list(
          withDirectory(dir, input) as any,
          { signal: opts?.signal } as any,
        );
        const raw = (res as any)?.data ?? res;
        const items = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
        // Drop non-chat OC2 timeline entries (agent/model switches, idle markers,
        // skill/shell events); BloxMind renders user and assistant messages only.
        return {
          data: items
            .filter(
              (m: any) =>
                m?.type === "user" ||
                m?.type === "assistant" ||
                m?.info?.role === "user" ||
                m?.info?.role === "assistant",
            )
            .map((m: any) => translateOc2Message(input.sessionID, m)),
        };
      },
      status: (_input?: Record<string, unknown>, opts?: V1Options) => {
        // OC2 `session.active()` returns only running sessions as { [id]: {type:"running"} }.
        // BloxMind expects a full status map; synthesize idle-absence compat by returning the active map.
        return v1(
          oc2.session.active(opts?.signal ? { signal: opts.signal } : undefined).then((active) => {
            // OC2 `session.active` reports `{type:"running"}`; BloxMind's UI
            // transitions (checkpoints/completion cue) key off OC1 `"busy"`.
            const mapped: Record<string, unknown> = {};
            for (const [id, status] of Object.entries(
              (active ?? {}) as Record<string, { type?: string }>,
            )) {
              mapped[id] = status?.type === "running" ? { ...status, type: "busy" } : status;
            }
            return mapped;
          }),
          opts,
        );
      },
      todo: async (input: { sessionID: string }, opts?: V1Options) => {
        // OC2 has no session.todo endpoint: todos live in the latest `todowrite`
        // tool call, so derive them from the message history.
        try {
          const res = await oc2.message.list(
            withDirectory(dir, input) as any,
            { signal: opts?.signal } as any,
          );
          const raw = (res as any)?.data ?? res;
          const items = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
          let todos: unknown[] = [];
          for (const message of items) {
            const content = Array.isArray(message?.content) ? message.content : [];
            for (const entry of content) {
              const name = String(entry?.name ?? "");
              if (
                entry?.type !== "tool" ||
                !(name === "todowrite" || name.endsWith("_todowrite"))
              ) {
                continue;
              }
              const candidate = entry?.state?.input?.todos ?? entry?.state?.metadata?.todos;
              if (Array.isArray(candidate)) todos = candidate;
            }
          }
          return { data: todos };
        } catch {
          return { data: [] as unknown[] };
        }
      },
      create: (input?: Record<string, unknown>, opts?: V1Options) => {
        const raw = { ...(input ?? {}) } as Record<string, unknown>;
        // OC1 used `permission` (PermissionRuleset/rules); OC2 SessionCreateInput uses `permissions` array.
        if (raw.permission && !raw.permissions) {
          const p = raw.permission;
          if (Array.isArray(p)) {
            raw.permissions = p.map((rule: any) => ({
              action: rule?.permission ?? rule?.action ?? "*",
              resource: rule?.pattern ?? rule?.resource ?? "*",
              effect: rule?.action === "deny" ? "deny" : "ask",
            }));
          }
          delete raw.permission;
        }
        const model = normalizeOc2Model(raw.model);
        if (model) raw.model = model;
        return v1(oc2.session.create(withDirectory(dir, raw) as never, { signal: opts?.signal }));
      },
      get: (input: Record<string, unknown>, opts?: V1Options) =>
        v1(oc2.session.get(withDirectory(dir, input) as never, { signal: opts?.signal })),
      delete: (input: { sessionID: string }, opts?: V1Options) =>
        v1(
          oc2.session
            .remove(withDirectory(dir, input) as never, { signal: opts?.signal })
            .then(() => true),
        ),
      update: async (input: Record<string, unknown>, opts?: V1Options) => {
        // OC1: { sessionID, title?, time: { archived: ms } }. OC2: { sessionID, title?, archived?: boolean } — archive
        // is a boolean; directory is ignored (engine cwd is the workspace).
        const raw = { ...(input ?? {}) } as Record<string, unknown>;
        const translated: Record<string, unknown> = { sessionID: raw.sessionID };
        if (typeof raw.title === "string") translated.title = raw.title;
        if (raw.metadata && typeof raw.metadata === "object") translated.metadata = raw.metadata;
        if (typeof raw.archived === "boolean") translated.archived = raw.archived;
        else if (raw.time && typeof raw.time === "object") {
          // Translate legacy OC1 `{ time: { archived: ms } }`; archive truthy unless exactly 0.
          translated.archived = Boolean((raw.time as { archived?: number }).archived);
        }
        await oc2.session.update(withDirectory(dir, translated) as never, {
          signal: opts?.signal,
        });
        // OC2 returns void; hand back a truthy Session-ish stub for callers that expect one.
        const now = Date.now();
        return {
          data: {
            ...translated,
            id: raw.sessionID,
            time: {
              created: now,
              updated: now,
              ...(translated.archived ? { archived: now } : {}),
            },
          } as unknown as Session,
        };
      },
      abort: (input: { sessionID: string }, opts?: V1Options) =>
        v1(
          oc2.session
            .interrupt(withDirectory(dir, input) as never, { signal: opts?.signal })
            .then((r) => (r as { interrupted?: boolean })?.interrupted ?? true),
        ),
      promptAsync: async (input: Record<string, unknown>, opts?: V1Options) => {
        const translated = await translateOc1Prompt(oc2, dir, input, opts);
        const synthetic = (oc2.session as Record<string, unknown>).synthetic as
          | ((i: unknown, o?: unknown) => Promise<unknown>)
          | undefined;
        const { __noReply, ...rest } = translated as Record<string, unknown> & {
          __noReply?: boolean;
        };
        if (__noReply && synthetic) {
          const data = await synthetic(
            { sessionID: rest.sessionID, text: rest.text, metadata: rest.metadata },
            { signal: opts?.signal },
          );
          return { data };
        }
        const data = await oc2.session.prompt(rest as never, { signal: opts?.signal });
        return { data };
      },
      prompt: async (input: Record<string, unknown>, opts?: V1Options) => {
        const translated = await translateOc1Prompt(oc2, dir, input, opts);
        const synthetic = (oc2.session as Record<string, unknown>).synthetic as
          | ((i: unknown, o?: unknown) => Promise<unknown>)
          | undefined;
        const { __noReply, ...rest } = translated as Record<string, unknown> & {
          __noReply?: boolean;
        };
        if (__noReply && synthetic) {
          return v1(
            synthetic(
              { sessionID: rest.sessionID, text: rest.text, metadata: rest.metadata },
              { signal: opts?.signal },
            ),
            opts,
          );
        }
        await oc2.session.prompt(rest as never, { signal: opts?.signal });
        const sessionID = rest.sessionID as string;
        await waitForTurn(sessionID, opts);
        const final = await latestAssistantMessage(sessionID, opts);
        return {
          data:
            final ??
            ({
              info: { sessionID, role: "assistant" },
              parts: [],
            } as { info: any; parts: any[] }),
        };
      },
      compact: (input: Record<string, unknown>, opts?: V1Options) =>
        v1(oc2.session.compact(withDirectory(dir, input) as never, { signal: opts?.signal })),
      command: async (input: Record<string, unknown>, opts?: V1Options) => {
        const translated = await translateOc1Command(oc2, dir, input, opts);
        return v1(oc2.session.command(translated as never, { signal: opts?.signal }), opts);
      },
      revert: {
        stage: (input: Record<string, unknown>, opts?: V1Options) =>
          v1(
            oc2.session.revert.stage(withDirectory(dir, input) as never, { signal: opts?.signal }),
          ),
        clear: (input: Record<string, unknown>, opts?: V1Options) =>
          v1(
            oc2.session.revert.clear(withDirectory(dir, input) as never, { signal: opts?.signal }),
          ),
        commit: (input: Record<string, unknown>, opts?: V1Options) =>
          v1(
            oc2.session.revert.commit(withDirectory(dir, input) as never, { signal: opts?.signal }),
          ),
      },
      children: async (_input: Record<string, unknown>, _opts?: V1Options) => {
        // Not directly exposed the same way in OC2 core; degrade safely.
        return { data: [] as unknown[] };
      },
      share: async (input: Record<string, unknown>, _opts?: V1Options) => ({ data: input }),
      unshare: async (input: Record<string, unknown>, _opts?: V1Options) => ({ data: input }),
      summarize: (input: Record<string, unknown>, opts?: V1Options) =>
        v1(oc2.session.compact(withDirectory(dir, input) as never, { signal: opts?.signal })),
    },
    experimental: {
      session: {
        list: (input?: Record<string, unknown>, opts?: V1Options): Promise<{ data: Session[] }> =>
          v1(
            oc2.session
              .list(withDirectory(dir, (input ?? {}) as Record<string, unknown>) as never, {
                signal: opts?.signal,
              })
              .then((r) => {
                // OC2 returns SessionsResponse { data, cursor }; OC1 BloxMind expects res.data to be the array.
                if (
                  r &&
                  typeof r === "object" &&
                  "data" in r &&
                  Array.isArray((r as { data: unknown }).data)
                ) {
                  return (r as unknown as { data: Session[] }).data;
                }
                return (Array.isArray(r) ? r : []) as unknown as Session[];
              }),
          ),
      },
    },
    provider: {
      list: async (input?: Record<string, unknown>, opts?: V1Options) => {
        // OC2 splits providers/models; rebuild OC1 `{ all, default, connected }`.
        try {
          const [providers, models, defaultModel, integrations] = await Promise.all([
            oc2.provider.list(
              withDirectory(dir, (input ?? {}) as Record<string, unknown>) as never,
              { signal: opts?.signal } as never,
            ),
            oc2.model
              .list(withDirectory(dir, {}) as never, { signal: opts?.signal } as never)
              .catch(() => [] as unknown),
            oc2.model
              .default(withDirectory(dir, {}) as never, { signal: opts?.signal } as never)
              .catch(() => null),
            oc2.integration
              .list(withDirectory(dir, {}) as never, { signal: opts?.signal } as never)
              .catch(() => [] as unknown),
          ]);
          return {
            data: translateOc2ProviderList(
              unwrapList(providers),
              unwrapList(models),
              (defaultModel as { data?: unknown })?.data ?? defaultModel,
              unwrapList(integrations),
            ),
          };
        } catch {
          return { data: { all: [], default: {}, connected: [] } };
        }
      },
      auth: async (_input?: Record<string, unknown>, opts?: V1Options) => {
        // OC2 integrations -> OC1 `{ [providerID]: ProviderAuthMethod[] }`.
        try {
          const [providers, integrations] = await Promise.all([
            oc2.provider
              .list(withDirectory(dir, {}) as never, { signal: opts?.signal } as never)
              .catch(() => [] as unknown),
            oc2.integration
              .list(withDirectory(dir, {}) as never, { signal: opts?.signal } as never)
              .catch(() => [] as unknown),
          ]);
          return {
            data: translateOc2AuthMethods(unwrapList(providers), unwrapList(integrations)),
          };
        } catch {
          return { data: undefined as unknown };
        }
      },
      oauth: {
        authorize: async (input: Record<string, unknown>, opts?: V1Options) => {
          const providerID = input.providerID as string | undefined;
          if (!providerID) return { data: undefined };
          const integrationID = await resolveIntegrationID(providerID, opts);
          let methodID = typeof input.methodID === "string" ? input.methodID : undefined;
          if (!methodID) {
            try {
              const integrations = unwrapList(
                await oc2.integration.list(
                  withDirectory(dir, {}) as never,
                  {
                    signal: opts?.signal,
                  } as never,
                ),
              );
              const integration = integrations.find((entry: any) => entry?.id === integrationID);
              const methods = Array.isArray(integration?.methods) ? integration.methods : [];
              // The connect dialog lists the same oauth/key methods we show, so
              // index into the same filtered view — an env method has no id and
              // would shift every index.
              const eligible = methods.filter(
                (method: any) => method?.type === "oauth" || method?.type === "key",
              );
              const index = typeof input.method === "number" ? input.method : 0;
              methodID =
                eligible[index]?.id ?? eligible[0]?.id ?? methods.find((m: any) => m?.id)?.id;
            } catch {
              methodID = undefined;
            }
          }
          if (!methodID) return { data: undefined };
          const res = await oc2.integration.oauth.connect(
            withDirectory(dir, {
              integrationID,
              methodID,
              answer:
                input.answer ??
                input.inputs ??
                (input.form && typeof input.form === "object" ? input.form : undefined),
            }) as never,
            { signal: opts?.signal } as never,
          );
          const attempt = (res as { data?: unknown })?.data ?? res;
          if (attempt && typeof attempt === "object" && "attemptID" in attempt) {
            oauthAttempts.set(providerID, {
              integrationID,
              attemptID: String((attempt as { attemptID: unknown }).attemptID),
            });
            // OC1 ProviderAuthAuthorization reads { url, method, instructions };
            // OC2 IntegrationAttempt carries the same data as { url, instructions, mode }.
            const source = attempt as {
              url?: string;
              instructions?: string;
              mode?: string;
              attemptID?: string;
            };
            return {
              data: {
                url: source.url,
                method: source.mode,
                instructions: source.instructions ?? "",
                attemptID: source.attemptID,
              },
            };
          }
          return { data: attempt };
        },
        callback: async (input: Record<string, unknown>, opts?: V1Options) => {
          const providerID = input.providerID as string | undefined;
          const stored = providerID ? oauthAttempts.get(providerID) : undefined;
          const integrationID =
            stored?.integrationID ??
            (typeof input.integrationID === "string" ? input.integrationID : providerID);
          const attemptID =
            stored?.attemptID ??
            (typeof input.attemptID === "string" ? input.attemptID : undefined);
          if (!integrationID || !attemptID) return { data: false };
          try {
            await oc2.integration.oauth.complete(
              withDirectory(dir, {
                integrationID,
                attemptID,
                ...(typeof input.code === "string" ? { code: input.code } : {}),
              }) as never,
              { signal: opts?.signal } as never,
            );
            if (providerID) oauthAttempts.delete(providerID);
            return { data: true };
          } catch {
            return { data: false };
          }
        },
      },
    },
    config: {
      get: (input?: Record<string, unknown>, opts?: V1Options) =>
        v1(
          oc2.config.get(withDirectory(dir, (input ?? {}) as Record<string, unknown>) as never, {
            signal: opts?.signal,
          }),
        ),
      update: (input: Record<string, unknown>, opts?: V1Options) =>
        v1(
          (
            oc2.config as unknown as { update: (i: unknown, o?: unknown) => Promise<unknown> }
          ).update(withDirectory(dir, input), { signal: opts?.signal }),
        ),
      providers: async (_input?: Record<string, unknown>, opts?: V1Options) => {
        // OC1 exposed config.providers(); OC2 provider.list is the source of truth.
        return v1(oc2.provider.list(withDirectory(dir, {}) as never, { signal: opts?.signal }));
      },
    },
    app: {
      agents: async (input?: Record<string, unknown>, opts?: V1Options) => {
        const res = await oc2.agent.list(
          withDirectory(dir, (input ?? {}) as Record<string, unknown>) as never,
          { signal: opts?.signal } as never,
        );
        return { data: unwrapList(res) };
      },
      skills: (input?: Record<string, unknown>, opts?: V1Options) =>
        v1(
          oc2.skill.list(withDirectory(dir, (input ?? {}) as Record<string, unknown>) as never, {
            signal: opts?.signal,
          }),
        ),
    },
    command: {
      // OC2 list endpoints return `{ location, data: [] }`; hand back the array.
      list: async (input?: Record<string, unknown>, opts?: V1Options) => {
        const res = await oc2.command.list(
          withDirectory(dir, (input ?? {}) as Record<string, unknown>) as never,
          { signal: opts?.signal } as never,
        );
        return { data: unwrapList(res) };
      },
    },
    agent: {
      list: async (input?: Record<string, unknown>, opts?: V1Options) => {
        const res = await oc2.agent.list(
          withDirectory(dir, (input ?? {}) as Record<string, unknown>) as never,
          { signal: opts?.signal } as never,
        );
        return { data: unwrapList(res) };
      },
    },
    tool: {
      ids: async (_input?: Record<string, unknown>, _opts?: V1Options) => ({
        data: [] as string[],
      }),
      list: async (_input?: Record<string, unknown>, _opts?: V1Options) => ({
        data: [] as unknown[],
      }),
    },
    path: {
      get: async (_input?: Record<string, unknown>, _opts?: V1Options) => ({
        data: { directory: dir },
      }),
    },
    project: {
      list: (input?: Record<string, unknown>, opts?: V1Options) =>
        v1(
          oc2.project.list(withDirectory(dir, (input ?? {}) as Record<string, unknown>) as never, {
            signal: opts?.signal,
          }),
        ),
      current: async (_input?: Record<string, unknown>, _opts?: V1Options) => ({ data: undefined }),
    },
    mcp: {
      status: async (_input?: Record<string, unknown>, opts?: V1Options) => {
        const list = await oc2.mcp.list(withDirectory(dir, {}) as never, { signal: opts?.signal });
        // OC2 returns McpListOutput; OC1 BloxMind expects { data: { [name]: {status} } }
        const map: Record<string, { status: string }> = {};
        const items = Array.isArray(list)
          ? list
          : list && typeof list === "object" && "data" in list
            ? (list as { data: unknown }).data
            : list;
        if (Array.isArray(items)) {
          for (const item of items as Array<{
            name?: string;
            status?: { status?: string } | string;
          }>) {
            if (item?.name)
              map[item.name] = {
                status:
                  typeof item.status === "string"
                    ? item.status
                    : (item.status?.status ?? "unknown"),
              };
          }
        } else if (items && typeof items === "object") {
          for (const [name, val] of Object.entries(items as Record<string, unknown>)) {
            const v = val as { status?: string } | string;
            map[name] = { status: typeof v === "string" ? v : (v?.status ?? "unknown") };
          }
        }
        return { data: map };
      },
      connect: async (input: { name: string }, opts?: V1Options) => {
        const exp = oc2.experimental?.mcp as
          | { connect?: (i: unknown, o?: unknown) => Promise<unknown> }
          | undefined;
        if (exp?.connect)
          return v1(exp.connect(withDirectory(dir, input), { signal: opts?.signal }));
        return { data: undefined };
      },
      add: async (input: Record<string, unknown>, opts?: V1Options) => {
        const exp = oc2.experimental?.mcp as
          | { add?: (i: unknown, o?: unknown) => Promise<unknown> }
          | undefined;
        if (exp?.add) return v1(exp.add(withDirectory(dir, input), { signal: opts?.signal }));
        return { data: undefined };
      },
      disconnect: async (input: Record<string, unknown>, opts?: V1Options) => {
        const exp = oc2.experimental?.mcp as
          | { disconnect?: (i: unknown, o?: unknown) => Promise<unknown> }
          | undefined;
        if (exp?.disconnect)
          return v1(exp.disconnect(withDirectory(dir, input), { signal: opts?.signal }));
        return { data: undefined };
      },
      auth: {
        authenticate: async () => ({ data: undefined }),
        callback: async () => ({ data: undefined }),
        start: async () => ({ data: undefined }),
        remove: async () => ({ data: undefined }),
      },
    },
    question: {
      list: async (
        input?: Record<string, unknown>,
        opts?: V1Options,
      ): Promise<{ data: QuestionRequest[] }> => {
        // OC2 uses per-session forms; no global question.list.
        const sessionID = (input as { sessionID?: string } | undefined)?.sessionID;
        if (!sessionID) return { data: [] as QuestionRequest[] };
        try {
          const listed = await oc2.session.form
            .list(withDirectory(dir, { sessionID }) as never, { signal: opts?.signal } as never)
            .catch(() => [] as unknown);
          const forms = Array.isArray((listed as { data?: unknown })?.data)
            ? (listed as { data: unknown[] }).data
            : Array.isArray(listed)
              ? listed
              : [];
          return {
            data: forms
              .map((form) => translateOc2Form(form))
              .filter((question): question is QuestionRequest => !!question),
          };
        } catch {
          return { data: [] as QuestionRequest[] };
        }
      },
      reply: async (input: Record<string, unknown>, opts?: V1Options) => {
        // OC2 form reply takes sessionID+formID+answer; OC1 question reply took requestID+answers.
        const sessionID = input.sessionID as string | undefined;
        const formID = (input.requestID ?? input.formID) as string | undefined;
        const form = oc2.session?.form;
        if (!form?.reply || !sessionID || !formID) return { data: true };
        let answer: unknown = input.answers ?? input.answer;
        // Prefer a field-aware mapping; fall back to the raw payload if the form is gone.
        try {
          const detail = await form.get(
            withDirectory(dir, { sessionID, formID }) as never,
            { signal: opts?.signal } as never,
          );
          const formDetail = (detail as { data?: unknown })?.data ?? detail;
          if (formDetail && typeof formDetail === "object") {
            answer = buildOc2FormAnswer(formDetail, input.answers ?? input.answer);
          }
        } catch {}
        return v1(
          form.reply({ sessionID, formID, answer } as never, { signal: opts?.signal } as never),
        );
      },
      reject: async (input: Record<string, unknown>, opts?: V1Options) => {
        try {
          const form = oc2.session?.form as
            | { cancel?: (i: unknown, o?: unknown) => Promise<unknown> }
            | undefined;
          if (form?.cancel && input.sessionID && (input.requestID ?? input.formID)) {
            return v1(
              form.cancel(
                { sessionID: input.sessionID, formID: input.requestID ?? input.formID } as never,
                { signal: opts?.signal },
              ),
            );
          }
        } catch {}
        return { data: true };
      },
    },
    permission: {
      list: async (
        input?: Record<string, unknown>,
        opts?: V1Options,
      ): Promise<{ data: PermissionRequest[] }> => {
        const sessionID = (input as { sessionID?: string } | undefined)?.sessionID;
        if (sessionID) {
          const res = await oc2.permission.list(withDirectory(dir, { sessionID }) as never, {
            signal: opts?.signal,
          });
          const data = Array.isArray(res)
            ? res
            : res && typeof res === "object" && "data" in (res as object)
              ? (res as { data: unknown }).data
              : res;
          const requests = (Array.isArray(data) ? data : []).map((request) =>
            normalizePermissionRequest(request as Record<string, unknown>),
          );
          return { data: requests };
        }
        // OC1 returned all pending requests; OC2 exposes this as permission.request.list().
        const listed = await oc2.permission.request.list(
          dir ? ({ location: { directory: dir } } as never) : ({} as never),
          opts?.signal ? ({ signal: opts.signal } as never) : undefined,
        );
        const data =
          listed && typeof listed === "object" && "data" in (listed as object)
            ? (listed as { data: unknown[] }).data
            : listed;
        const requests = (Array.isArray(data) ? data : []).map((request) =>
          normalizePermissionRequest(request as Record<string, unknown>),
        );
        return { data: requests };
      },
      reply: (input: Record<string, unknown>, opts?: V1Options) => {
        const mapped = {
          ...input,
          decision:
            (input as { decision?: string; reply?: string }).decision ??
            (input as { reply?: string }).reply,
        };
        return v1(
          oc2.permission.reply(withDirectory(dir, mapped) as never, { signal: opts?.signal }),
          opts,
        );
      },
    },
    // OC1 compatibility: BloxMind's provider connect/disconnect flows use auth + instance.dispose.
    // OC2 has credential/integration APIs and no instance.dispose; bridges are best-effort/verified-safe.
    auth: {
      set: async (
        input: { providerID: string; auth: { type: string; key?: string; [k: string]: unknown } },
        opts?: V1Options,
      ) => {
        if (input?.auth?.type === "api" && typeof input.auth.key === "string") {
          const integrationID = await resolveIntegrationID(input.providerID, opts);
          try {
            await oc2.credential.create(
              {
                integrationID,
                label: input.providerID,
                value: { type: "key", key: input.auth.key },
              } as never,
              { signal: opts?.signal } as never,
            );
            return { data: true };
          } catch {
            // Fall through to experimental/legacy paths if present.
          }
        }
        const exp = (oc2 as any).experimental?.auth as
          | { set?: (i: unknown, o?: unknown) => Promise<unknown> }
          | undefined;
        if (exp?.set) return v1(exp.set(input, { signal: opts?.signal }), opts);
        throw new Error("Provider authentication is not available for this OC2 engine API.");
      },
      remove: async (input: { providerID: string }, opts?: V1Options) => {
        try {
          const integrationID = await resolveIntegrationID(input.providerID, opts);
          const entries = unwrapList(await oc2.credential.list({ signal: opts?.signal } as never));
          const matches = entries.filter(
            (e: any) =>
              e?.integrationID === integrationID ||
              e?.integrationID === input.providerID ||
              e?.providerID === input.providerID ||
              e?.id === input.providerID ||
              e?.label === input.providerID,
          );
          for (const m of matches) {
            if (m?.id)
              await oc2.credential
                .remove({ credentialID: m.id } as never, { signal: opts?.signal } as never)
                .catch(() => {});
          }
          if (matches.length) return { data: true };
        } catch {}
        const exp = (oc2 as any).experimental?.auth as
          | { remove?: (i: unknown, o?: unknown) => Promise<unknown> }
          | undefined;
        if (exp?.remove) return v1(exp.remove(input, { signal: opts?.signal }), opts);
        return { data: true };
      },
    },
    instance: {
      dispose: async (_input?: Record<string, unknown>, _opts?: V1Options) => {
        // OC2 client has no instance.dispose; no-op keeps OC1 refresh flows from throwing.
        return { data: true };
      },
    },
    event: {
      subscribe: async (input?: Record<string, unknown>, opts?: V1Options) => {
        // OC2 returns AsyncIterable directly; OC1 returned { stream }.
        const stream = (
          oc2.event.subscribe as (
            input?: unknown,
            requestOptions?: unknown,
          ) => AsyncIterable<unknown>
        )(
          withDirectory(dir, (input ?? {}) as Record<string, unknown>),
          opts?.signal ? { signal: opts.signal } : undefined,
        );
        return { stream };
      },
    },
    global: {
      event: async (_opts?: V1Options) => client.event.subscribe({}, _opts),
      config: {
        get: (input?: Record<string, unknown>, opts?: V1Options) =>
          v1(
            oc2.config.get(withDirectory(dir, (input ?? {}) as Record<string, unknown>) as never, {
              signal: opts?.signal,
            }),
            opts,
          ),
        update: (input: Record<string, unknown>, opts?: V1Options) => {
          const experimental = oc2.experimental?.config as
            | { update?: (i: unknown, o?: unknown) => Promise<unknown> }
            | undefined;
          if (experimental?.update)
            return v1(
              experimental.update(withDirectory(dir, input), { signal: opts?.signal }),
              opts,
            );
          return v1(Promise.resolve(undefined), opts);
        },
      },
    },
    file: oc2.file,
    find: (oc2 as unknown as Record<string, unknown>).find ?? {},
    pty: oc2.pty,
    vcs: oc2.vcs,
    worktree: oc2.worktree,
  };

  return client as unknown as OpencodeClient;
}
