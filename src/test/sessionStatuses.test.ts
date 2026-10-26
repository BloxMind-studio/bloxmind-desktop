/**
 * The status watchdog poll shares `qk.statuses` with the SSE writer. A poll
 * that started before a `session.status`/`session.idle` event must not apply its
 * older snapshot on top of the newer one.
 */

import type { OpencodeClient, SessionStatus } from "@opencode-ai/sdk/v2/client";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { fetchStatuses } from "@/hooks/useSessionStatuses";
import { qk } from "@/lib/queryKeys";

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
}

function statusClient(
  status: () => Promise<{ data: Record<string, SessionStatus> }>,
): OpencodeClient {
  return { session: { status } } as unknown as OpencodeClient;
}

describe("fetchStatuses", () => {
  it("returns the server snapshot when nothing else wrote to the cache", async () => {
    const qc = makeQC();
    qc.setQueryData(qk.statuses, { s1: { type: "busy" } as SessionStatus });
    const client = statusClient(async () => ({
      data: { s1: { type: "idle" } as SessionStatus },
    }));

    await expect(fetchStatuses(client, qc)).resolves.toEqual({ s1: { type: "idle" } });
  });

  it("keeps a newer status SSE wrote while the poll was in flight", async () => {
    const qc = makeQC();
    qc.setQueryData(qk.statuses, { s1: { type: "busy" } as SessionStatus });

    let release!: (value: { data: Record<string, SessionStatus> }) => void;
    const response = new Promise<{ data: Record<string, SessionStatus> }>((resolve) => {
      release = resolve;
    });
    const client = statusClient(() => response);

    const pending = fetchStatuses(client, qc);
    // The turn finishes while the watchdog request is still open.
    qc.setQueryData(qk.statuses, { s1: { type: "idle" } as SessionStatus });
    release({ data: { s1: { type: "busy" } as SessionStatus } });

    await expect(pending).resolves.toEqual({ s1: { type: "idle" } });
    expect(qc.getQueryData(qk.statuses)).toEqual({ s1: { type: "idle" } });
  });

  it("reports no statuses without a client", async () => {
    await expect(fetchStatuses(null, makeQC())).resolves.toEqual({});
  });
});
