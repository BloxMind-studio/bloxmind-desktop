import * as OC from "@opencode/client/promise";
import type { PermissionRequest, QuestionRequest, Session } from "./types";

export type V1Options = { throwOnError?: boolean; signal?: AbortSignal; [key: string]: unknown };

/** Normalize OC2 direct-promise results to OC1 `{ data }` shape when `throwOnError` is used. */
async function v1<T>(promise: Promise<T>, _opts?: V1Options): Promise<{ data: T }> {
  const data = await promise;
  return { data };
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
  const make =
    (OC as { make?: typeof OC.OpenCode.make; OpenCode?: { make: typeof OC.OpenCode.make } }).make ??
    (OC as { OpenCode: { make: (o: unknown) => unknown } }).OpenCode.make;
  const oc2 = make({
    baseUrl: config.baseUrl,
    headers: config.headers,
    fetch: config.fetch,
  }) as ReturnType<typeof OC.OpenCode.make>;
  const dir = config.directory;

  const client = {
    _oc2: oc2,
    session: {
      messages: (input: { sessionID: string }, opts?: V1Options) =>
        v1(
          oc2.message.list(withDirectory(dir, input) as { sessionID: string; directory?: string }, {
            signal: opts?.signal,
          }),
        ),
      status: (_input?: Record<string, unknown>, opts?: V1Options) => {
        // OC2 `session.active()` returns only running sessions as { [id]: {type:"running"} }.
        // BloxMind expects a full status map; synthesize idle-absence compat by returning the active map.
        return v1(
          oc2.session
            .active(opts?.signal ? { signal: opts.signal } : undefined)
            .then((active) => active as Record<string, unknown>),
          opts,
        );
      },
      todo: async (input: { sessionID: string }, opts?: V1Options) => {
        // OC2 has no direct session.todo endpoint in the core client; preserve shape.
        // If the engine exposes it via RPC/extensions, callers degrade to empty.
        const rpc = (
          oc2 as unknown as { rpc?: { call?: (i: unknown, o?: unknown) => Promise<unknown> } }
        ).rpc;
        if (rpc?.call) {
          try {
            const out = (await rpc.call(
              { method: "session.todo", input: withDirectory(dir, input) },
              { signal: opts?.signal },
            )) as { output?: unknown };
            return { data: Array.isArray(out?.output) ? out.output : (out?.output ?? []) };
          } catch {
            return { data: [] };
          }
        }
        return { data: [] as unknown[] };
      },
      create: (input?: Record<string, unknown>, opts?: V1Options) =>
        v1(
          oc2.session.create(
            withDirectory(dir, (input ?? {}) as Record<string, unknown>) as never,
            { signal: opts?.signal },
          ),
        ),
      get: (input: Record<string, unknown>, opts?: V1Options) =>
        v1(oc2.session.get(withDirectory(dir, input) as never, { signal: opts?.signal })),
      delete: (input: { sessionID: string }, opts?: V1Options) =>
        v1(
          oc2.session
            .remove(withDirectory(dir, input) as never, { signal: opts?.signal })
            .then(() => true),
        ),
      update: (input: Record<string, unknown>, opts?: V1Options) =>
        v1(oc2.session.update(withDirectory(dir, input) as never, { signal: opts?.signal })),
      abort: (input: { sessionID: string }, opts?: V1Options) =>
        v1(
          oc2.session
            .interrupt(withDirectory(dir, input) as never, { signal: opts?.signal })
            .then((r) => (r as { interrupted?: boolean })?.interrupted ?? true),
        ),
      promptAsync: async (input: Record<string, unknown>, opts?: V1Options) => {
        // OC2 exposes `prompt` (synchronous API call that enqueues/returns inbox info) and streaming via events.
        // BloxMind's promptAsync was fire-and-forget; return a compatible shape.
        const data = await oc2.session.prompt(withDirectory(dir, input) as never, {
          signal: opts?.signal,
        });
        return { data };
      },
      prompt: (input: Record<string, unknown>, opts?: V1Options) =>
        v1(oc2.session.prompt(withDirectory(dir, input) as never, { signal: opts?.signal })),
      compact: (input: Record<string, unknown>, opts?: V1Options) =>
        v1(oc2.session.compact(withDirectory(dir, input) as never, { signal: opts?.signal })),
      command: (input: Record<string, unknown>, opts?: V1Options) =>
        v1(oc2.session.command(withDirectory(dir, input) as never, { signal: opts?.signal })),
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
      list: (input?: Record<string, unknown>, opts?: V1Options) =>
        v1(
          oc2.provider.list(withDirectory(dir, (input ?? {}) as Record<string, unknown>) as never, {
            signal: opts?.signal,
          }),
        ),
      auth: async (_input?: Record<string, unknown>, _opts?: V1Options) => {
        // OC2 moved auth/credentials; return undefined so callers keep working (useProviders catches).
        return { data: undefined as unknown };
      },
      oauth: {
        authorize: async (input: Record<string, unknown>, opts?: V1Options) => {
          const integration = (
            oc2 as unknown as {
              integration?: { oauth?: { connect?: (i: unknown, o?: unknown) => Promise<unknown> } };
            }
          ).integration;
          if (integration?.oauth?.connect)
            return v1(
              integration.oauth.connect(withDirectory(dir, input), { signal: opts?.signal }),
            );
          return { data: undefined };
        },
        callback: async (input: Record<string, unknown>, opts?: V1Options) => {
          const integration = (
            oc2 as unknown as {
              integration?: {
                oauth?: { complete?: (i: unknown, o?: unknown) => Promise<unknown> };
              };
            }
          ).integration;
          if (integration?.oauth?.complete)
            return v1(
              integration.oauth.complete(withDirectory(dir, input), { signal: opts?.signal }),
            );
          return { data: undefined };
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
      agents: (input?: Record<string, unknown>, opts?: V1Options) =>
        v1(
          oc2.agent.list(withDirectory(dir, (input ?? {}) as Record<string, unknown>) as never, {
            signal: opts?.signal,
          }),
        ),
      skills: (input?: Record<string, unknown>, opts?: V1Options) =>
        v1(
          oc2.skill.list(withDirectory(dir, (input ?? {}) as Record<string, unknown>) as never, {
            signal: opts?.signal,
          }),
        ),
    },
    command: {
      list: (input?: Record<string, unknown>, opts?: V1Options) =>
        v1(
          oc2.command.list(withDirectory(dir, (input ?? {}) as Record<string, unknown>) as never, {
            signal: opts?.signal,
          }),
        ),
    },
    agent: {
      list: (input?: Record<string, unknown>, opts?: V1Options) =>
        v1(
          oc2.agent.list(withDirectory(dir, (input ?? {}) as Record<string, unknown>) as never, {
            signal: opts?.signal,
          }),
        ),
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
        _input?: Record<string, unknown>,
        _opts?: V1Options,
      ): Promise<{ data: QuestionRequest[] }> => {
        // OC2 uses session forms; no global question.list. BloxMind filters by session in hooks.
        return { data: [] as QuestionRequest[] };
      },
      reply: async (input: Record<string, unknown>, opts?: V1Options) => {
        // Best-effort: OC2 form reply takes sessionID+formID+answer; OC1 question reply took requestID+answers.
        // Mapped in Step 4 if needed; keep call from throwing.
        try {
          const form = oc2.session?.form as
            | { reply?: (i: unknown, o?: unknown) => Promise<unknown> }
            | undefined;
          if (form?.reply && input.sessionID && (input.requestID ?? input.formID)) {
            return v1(
              form.reply(
                {
                  sessionID: input.sessionID,
                  formID: input.requestID ?? input.formID,
                  answer: input.answers ?? input.answer,
                } as never,
                { signal: opts?.signal },
              ),
            );
          }
        } catch {}
        return { data: true };
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
          return { data: (Array.isArray(data) ? data : []) as PermissionRequest[] };
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
        return { data: (Array.isArray(data) ? data : []) as PermissionRequest[] };
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
