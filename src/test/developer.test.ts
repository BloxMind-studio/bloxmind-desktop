import { describe, expect, it } from "vitest";
import {
  APP_DEVELOPER_SCHEMA,
  developerTranscript,
  resolveDeveloperReply,
} from "@/lib/appsBuilder/developer";
import type { AppChatMessage } from "@/lib/appsBuilder/types";

function structuredReply(reply: unknown) {
  return resolveDeveloperReply({ structured: reply }, undefined);
}

function textReply(text: string) {
  return resolveDeveloperReply(undefined, [{ type: "text", text }]);
}

describe("resolveDeveloperReply", () => {
  it("accepts structured output", () => {
    const reply = structuredReply({ response: "Nice idea!", build: true });
    expect(reply).toEqual({ response: "Nice idea!", build: true });
  });

  it("defaults build to false in structured output", () => {
    const reply = structuredReply({ response: "Mock data or live API?" });
    expect(reply.build).toBe(false);
  });

  it("parses JSON from plain text parts", () => {
    const reply = textReply('{"response":"On it.","build":true}');
    expect(reply).toEqual({ response: "On it.", build: true });
  });

  it("unwraps <structured_output> tags from text parts", () => {
    const reply = textReply(
      '<structured_output>{"response":"Let\'s start with mock data.","build":false}</structured_output>',
    );
    expect(reply.response).toBe("Let's start with mock data.");
    expect(reply.build).toBe(false);
  });

  it("strips a surrounding code fence", () => {
    const reply = textReply('```json\n{"response":"Sure.","build":true}\n```');
    expect(reply).toEqual({ response: "Sure.", build: true });
  });

  it("falls back to conversational text and never auto-builds", () => {
    const reply = textReply("Absolutely, a clean card layout sounds great. Want dark mode?");
    expect(reply).toEqual({
      response: "Absolutely, a clean card layout sounds great. Want dark mode?",
      build: false,
    });
  });

  it("recovers an inline JSON object appended to prose", () => {
    const reply = textReply(
      'On it — a weather dashboard with mock data, coming right up.{"response":"On it — a weather dashboard with mock data, coming right up.","build":true}',
    );
    expect(reply).toEqual({
      response: "On it — a weather dashboard with mock data, coming right up.",
      build: true,
    });
  });

  it("salvages a truncated inline JSON object", () => {
    const reply = textReply('Sure thing.{"response":"Sure thing.');
    expect(reply).toEqual({ response: "Sure thing.", build: false });
  });

  it("strips inline JSON from the fallback reply so raw output is never shown", () => {
    const reply = textReply('Sounds good.{"not":"the right shape"} and we can refine later');
    expect(reply).toEqual({
      response: "Sounds good. and we can refine later",
      build: false,
    });
  });

  it("returns a safe reply when there is no usable text", () => {
    expect(resolveDeveloperReply(undefined, [])).toEqual({
      response: "Let's keep shaping the idea.",
      build: false,
    });
  });

  it("honors a build commitment even when the flag was forgotten", () => {
    const reply = textReply(
      "On it — I'll build a clean Tailwind weather dashboard with mock data, coming right up.",
    );
    expect(reply).toEqual({
      response:
        "On it — I'll build a clean Tailwind weather dashboard with mock data, coming right up.",
      build: true,
    });
  });

  it("does not boost a commitment phrase that asks a question", () => {
    const reply = textReply("On it — should the forecast use mock data or a live API?");
    expect(reply.build).toBe(false);
  });

  it("boosts structured replies that say commit but set build false", () => {
    const reply = structuredReply({ response: "On it — let's do it.", build: false });
    expect(reply.build).toBe(true);
  });
});

describe("APP_DEVELOPER_SCHEMA", () => {
  it("describes response + build only", () => {
    expect(APP_DEVELOPER_SCHEMA.required).toEqual(["response", "build"]);
    expect(APP_DEVELOPER_SCHEMA.properties).toHaveProperty("response");
    expect(APP_DEVELOPER_SCHEMA.properties).toHaveProperty("build");
  });
});

describe("developerTranscript", () => {
  it("builds a compact role-labeled transcript", () => {
    const messages: AppChatMessage[] = [
      { id: "1", role: "user", text: "Weather app" },
      { id: "2", role: "assistant", text: "Mock data or API?" },
    ];
    expect(developerTranscript(messages)).toBe("user: Weather app\nassistant: Mock data or API?");
  });

  it("returns empty for no messages", () => {
    expect(developerTranscript([])).toBe("");
  });
});
