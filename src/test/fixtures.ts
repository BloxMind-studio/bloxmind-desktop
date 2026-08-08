/**
 * Typed SDK fixture builders for tests.
 *
 * These produce fully-populated SDK types so test files never need `as any`
 * when seeding query caches or rendering message parts. Override only the
 * fields the test cares about.
 */

import type {
  AssistantMessage,
  FilePart,
  TextPart,
  Todo,
  UserMessage,
} from "@opencode-ai/sdk/v2/client";

export function makeUserMessage(overrides: Partial<UserMessage> = {}): UserMessage {
  return {
    id: "m1",
    sessionID: "s1",
    role: "user",
    time: { created: 0 },
    agent: "build",
    model: { providerID: "opencode", modelID: "test-model" },
    ...overrides,
  };
}

export function makeAssistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id: "m1",
    sessionID: "s1",
    role: "assistant",
    time: { created: 0 },
    parentID: "m0",
    modelID: "test-model",
    providerID: "opencode",
    mode: "build",
    agent: "build",
    path: { cwd: "/workspace", root: "/workspace" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...overrides,
  };
}

export function makeTextPart(overrides: Partial<TextPart> = {}): TextPart {
  return {
    id: "p1",
    sessionID: "s1",
    messageID: "m1",
    type: "text",
    text: "",
    ...overrides,
  };
}

export function makeFilePart(overrides: Partial<FilePart> = {}): FilePart {
  return {
    id: "p1",
    sessionID: "s1",
    messageID: "m1",
    type: "file",
    mime: "image/png",
    url: "data:image/png;base64,test",
    ...overrides,
  };
}

export function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    content: "Do something",
    status: "pending",
    priority: "medium",
    ...overrides,
  };
}
