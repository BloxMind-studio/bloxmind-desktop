import { describe, expect, it } from "vitest";
import { buildOc2FormAnswer, translateOc2Form } from "@/lib/opencode/forms";
import {
  translateOc2AuthMethods,
  translateOc2ProviderList,
  unwrapList,
} from "@/lib/opencode/providers";

describe("OC2 provider/model translation", () => {
  it("unwrapList accepts both bare arrays and { data } envelopes", () => {
    expect(unwrapList([1, 2])).toEqual([1, 2]);
    expect(unwrapList({ data: [3] })).toEqual([3]);
    expect(unwrapList(undefined)).toEqual([]);
  });

  it("rebuilds OC1 { all, default, connected } from OC2 data", () => {
    const list = translateOc2ProviderList(
      [
        { id: "anthropic", name: "Anthropic", activation: "enabled" },
        { id: "local", name: "Local", activation: "disabled" },
      ],
      [
        {
          id: "claude",
          modelID: "claude",
          providerID: "anthropic",
          name: "Claude",
          status: "active",
          capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
          variants: [{ id: "fast", settings: { reasoning: "low" } }],
          limit: { context: 200_000, output: 8_000 },
          cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }],
        },
      ],
      { providerID: "anthropic", modelID: "claude" },
      [
        {
          id: "anthropic",
          name: "Anthropic",
          methods: [{ type: "env", names: ["ANTHROPIC_API_KEY"] }],
        },
        {
          id: "mistral",
          name: "Mistral",
          methods: [{ type: "key", label: "API key" }],
        },
      ],
    );

    // Enabled providers keep their models; the integration catalog is merged in.
    expect(list.all.map((entry) => entry.id)).toEqual(["anthropic", "local", "mistral"]);
    expect(list.all[0]).toMatchObject({
      id: "anthropic",
      source: "config",
      env: ["ANTHROPIC_API_KEY"],
    });
    expect(list.all[2]).toMatchObject({ id: "mistral", name: "Mistral", models: {} });
    expect(list.connected).toEqual(["anthropic"]);
    expect(list.default).toEqual({ anthropic: "claude" });
    expect(list.all[0]).toMatchObject({
      id: "anthropic",
      models: {
        claude: {
          name: "Claude",
          variants: { fast: { reasoning: "low" } },
          capabilities: { toolcall: true, input: { text: true, image: true } },
        },
      },
    });
  });

  it("maps OC2 integration methods to provider auth methods", () => {
    const methods = translateOc2AuthMethods(
      [{ id: "anthropic", integrationID: "anthropic-oauth" }],
      [
        {
          id: "anthropic-oauth",
          methods: [
            { id: "browser", type: "oauth", label: "Browser" },
            {
              type: "key",
              label: "API key",
              form: {
                fields: [{ key: "key", title: "Key", type: "string" }],
              },
            },
          ],
        },
      ],
    );

    expect(methods.anthropic.map((method) => method.type)).toEqual(["oauth", "api"]);
    expect(methods.anthropic[1].prompts).toEqual([{ type: "text", key: "key", message: "Key" }]);
  });
});

describe("OC2 form/question translation", () => {
  const form = {
    id: "form1",
    sessionID: "s1",
    title: "Setup",
    fields: [
      { key: "name", title: "Name", type: "string" },
      {
        key: "tools",
        title: "Tools",
        type: "multiselect",
        options: [
          { value: "bash", label: "Bash" },
          { value: "read", label: "Read" },
        ],
      },
      { key: "confirm", title: "Confirm", type: "boolean" },
      { key: "hidden", type: "string", hidden: true },
      { key: "ext", type: "external", url: "https://example.com" },
    ],
  };

  it("turns answerable fields into a question request", () => {
    const question = translateOc2Form(form);
    expect(question?.questions.map((entry) => entry.header)).toEqual(["Name", "Tools", "Confirm"]);
    expect(question?.questions[2].options.map((option) => option.label)).toEqual(["Yes", "No"]);
  });

  it("maps labels back to typed form values", () => {
    expect(buildOc2FormAnswer(form, [["Aiden"], ["Bash", "Read"], ["No"]])).toEqual({
      name: "Aiden",
      tools: ["bash", "read"],
      confirm: false,
    });
  });
});
