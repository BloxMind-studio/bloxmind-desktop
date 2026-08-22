import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { Effect, Schema } from "effect";

import {
  type StudioTargetProgramEnvelopes,
  StudioTargetProgramEnvelopesSchema,
} from "@/types/studioTarget";

const ENVELOPE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version", "contract", "source"],
  properties: {
    version: { const: 1 },
    contract: {
      type: "object",
      additionalProperties: false,
      required: ["name", "version", "inputSchemaVersion", "outputSchemaVersion"],
      properties: {
        name: { type: "string" },
        version: { type: "string" },
        inputSchemaVersion: { type: "string" },
        outputSchemaVersion: { type: "string" },
      },
    },
    source: { type: "string" },
  },
} as const;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["discovery", "selection"],
  properties: {
    discovery: ENVELOPE_JSON_SCHEMA,
    selection: ENVELOPE_JSON_SCHEMA,
  },
} as const;

const SYSTEM_PROMPT = `You generate two deterministic, import-free TypeScript programs for BloxMind's Studio target picker.
First inspect the Studio MCP capabilities available to you. Do not assume tool names, argument names, result shapes, or target identifiers.
Return envelopes for:
1. discovery: contract name "studio-target-discovery", version "1", inputSchemaVersion "1", outputSchemaVersion "1". Its async function run({ input, callTool }) lists connected Roblox Studio sessions/places and the currently selected target. Return { targets: [{ key, label, detail }], selectedKey, error }. Keys must be opaque stable strings suitable for passing back to the selector. Labels/details are user-facing. detail may be null. error may be null; when the Studio MCP answers with isError or no Studio is reachable, return targets: [] and error as a short user-facing explanation instead of fabricating targets.
2. selection: contract name "studio-target-selection", version "1", inputSchemaVersion "1", outputSchemaVersion "1". Its run receives input { targetKey }, re-lists the connected Studios, and verifies that targetKey is still connected right now — Roblox's MCP has no switch/activate tool and ids can rotate across reconnects, so return { selected: { key, label, detail }, verified: true } using the CURRENT id and label from the fresh listing. Throw if the target is stale, disconnected, or ambiguous, or if the Studio MCP answers with isError.
Each source must define exactly async function run({ input, callTool }) and use only JSON-safe values plus callTool(name,args). No imports, exports, eval, global state, prose, markdown fences, or hardcoded place/session identifiers. Normalize MCP content defensively. Return only the requested structured output.`;

interface StudioTargetModel {
  providerID: string;
  modelID: string;
}

export async function generateStudioTargetPrograms(
  client: OpencodeClient,
  model?: StudioTargetModel,
  agent?: string | null,
): Promise<StudioTargetProgramEnvelopes> {
  const created = await client.session.create(
    {
      title: "BloxMind Studio target setup",
      metadata: { BloxMindHidden: true, purpose: "studio-target-programs" },
    },
    { throwOnError: true },
  );
  const sessionID = created.data.id;
  try {
    const response = await client.session.prompt(
      {
        sessionID,
        model,
        agent: agent ?? undefined,
        system: SYSTEM_PROMPT,
        format: { type: "json_schema", schema: OUTPUT_SCHEMA, retryCount: 2 },
        parts: [
          { type: "text", text: "Inspect current Studio MCP tools and generate both programs." },
        ],
      },
      { throwOnError: true },
    );
    return Effect.runPromise(
      Schema.decodeUnknown(StudioTargetProgramEnvelopesSchema)(response.data.info.structured),
    );
  } finally {
    await client.session.delete({ sessionID }, { throwOnError: true }).catch(() => undefined);
  }
}
