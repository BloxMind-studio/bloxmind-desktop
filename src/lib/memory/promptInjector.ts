/**
 * Prompt injector — queries MemoryService before agent generation and prepends
 * relevant existing scripts / hierarchy context.
 * Used by useSendMessage hook and electron OpenCode config system prompt.
 */

import { Effect } from "effect";
import type { MemoryService } from "../../../electron/services/memory/MemoryService";

const TRIGGER_KEYWORDS = [
  "shop", "inventory", "leaderboard", "currency", "data", "datastore",
  "tool", "weapon", "quest", "dialog", "ui", "gui", "model", "module",
  "connect", "old", "existing", "my",
];

function shouldInject(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  // Always inject if prompt mentions connecting to existing things
  if (lower.includes("connect") || lower.includes("old") || lower.includes("existing") || lower.includes("my")) return true;
  return TRIGGER_KEYWORDS.some((k) => lower.includes(k));
}

export async function injectMemoryContext(
  memoryService: MemoryService | null,
  userPrompt: string,
): Promise<string | null> {
  if (!memoryService || !userPrompt || userPrompt.trim().length < 8) return null;
  if (!shouldInject(userPrompt)) return null;
  try {
    const result = await Effect.runPromise(memoryService.search(userPrompt, 6));
    if (!result.injected || result.hits.length === 0) return null;
    return result.injected;
  } catch {
    return null;
  }
}

export function augmentSystemPromptWithMemory(originalSystem: string | undefined, memoryContext: string | null): string | undefined {
  if (!memoryContext) return originalSystem;
  if (!originalSystem) return memoryContext;
  return `${originalSystem}\n\n${memoryContext}`;
}
