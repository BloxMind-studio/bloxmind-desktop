// OC1↔OC2 provider/model shape translation.
//
// OC1 `provider.list()` returned `{ all, default, connected }` with models
// nested per provider. OC2 returns a flat `ProviderInfo[]` at `provider.list`
// and `ModelInfo[]` at `model.list`, with a different capability/cost shape.
// BloxMind's chat/settings UI consumes the OC1 shape, so rebuild it here.

export function unwrapList<T = any>(value: unknown): T[] {
  const raw = (value as { data?: unknown })?.data ?? value;
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)) {
    return (raw as { data: T[] }).data;
  }
  return [];
}

function capabilityMap(values: unknown): Record<string, boolean> | undefined {
  if (!Array.isArray(values)) return undefined;
  const map: Record<string, boolean> = {};
  for (const value of values) {
    if (typeof value === "string") map[value] = true;
  }
  return map;
}

export function translateOc2Model(model: any, providerID: string): Record<string, unknown> {
  const input = capabilityMap(model?.capabilities?.input);
  const output = capabilityMap(model?.capabilities?.output);
  const variants: Record<string, Record<string, unknown>> = {};
  for (const variant of Array.isArray(model?.variants) ? model.variants : []) {
    if (variant?.id) variants[variant.id] = variant.settings ?? {};
  }
  const cost = Array.isArray(model?.cost) ? model.cost[0] : undefined;
  return {
    id: model?.modelID ?? model?.id,
    providerID,
    name: model?.name ?? model?.modelID ?? model?.id,
    ...(model?.family ? { family: model.family } : {}),
    status: model?.status ?? "active",
    variants,
    ...(model?.limit
      ? {
          limit: {
            context: model.limit.context,
            input: model.limit.input,
            output: model.limit.output,
          },
        }
      : {}),
    capabilities: {
      temperature: model?.capabilities?.temperature ?? true,
      attachment: !!(input?.image || input?.pdf || input?.audio || input?.video),
      toolcall: model?.capabilities?.tools ?? false,
      input,
      output,
    },
    ...(cost ? { cost: { input: cost.input, output: cost.output, cache: cost.cache } } : {}),
  };
}

export interface Oc1ProviderList {
  all: Array<Record<string, unknown>>;
  default: Record<string, string>;
  connected: string[];
}

export function translateOc2ProviderList(
  providers: any[],
  models: any[],
  defaultModel?: any,
): Oc1ProviderList {
  const all = providers.map((provider) => {
    const providerModels = models.filter(
      (model) => model?.providerID === provider?.id || model?.canonical === provider?.id,
    );
    const nested: Record<string, unknown> = {};
    for (const model of providerModels) {
      const translated = translateOc2Model(model, provider.id);
      if (typeof translated.id === "string") nested[translated.id] = translated;
    }
    return {
      id: provider?.id,
      name: provider?.name ?? provider?.id,
      source: provider?.activation === "enabled" ? "config" : "env",
      env: [],
      options: provider?.settings ?? {},
      models: nested,
    };
  });
  const defaults: Record<string, string> = {};
  if (defaultModel?.providerID) {
    defaults[defaultModel.providerID] = defaultModel.modelID ?? defaultModel.id;
  }
  return {
    all,
    default: defaults,
    // OC2 activation replaces OC1's `connected` array.
    connected: providers
      .filter((provider) => provider?.activation && provider.activation !== "disabled")
      .map((provider) => provider.id),
  };
}

function formFieldPrompts(form: unknown): unknown[] {
  const fields = Array.isArray((form as { fields?: unknown })?.fields)
    ? ((form as { fields: unknown[] }).fields as any[])
    : [];
  return fields
    .filter((field) => field && !field.hidden && typeof field.key === "string")
    .map((field) => {
      const when = Array.isArray(field.when)
        ? (() => {
            const first = field.when[0];
            if (!first || typeof first.key !== "string") return undefined;
            return {
              key: first.key,
              op: first.op === "neq" ? "neq" : "eq",
              value: String(first.value),
            };
          })()
        : undefined;
      if (Array.isArray(field.options) && field.options.length) {
        return {
          type: "select",
          key: field.key,
          message: field.title ?? field.description ?? field.key,
          options: field.options.map((option: any) => ({
            label: option?.label ?? String(option?.value ?? ""),
            value: String(option?.value ?? option?.label ?? ""),
          })),
          ...(when ? { when } : {}),
        };
      }
      return {
        type: "text",
        key: field.key,
        message: field.title ?? field.description ?? field.key,
        ...(typeof field.placeholder === "string" ? { placeholder: field.placeholder } : {}),
        ...(when ? { when } : {}),
      };
    });
}

/**
 * Rebuild OC1 `provider.auth()` (`{ [providerID]: ProviderAuthMethod[] }`) from
 * OC2 integrations, mapping each integration back to the providers it serves.
 */
export function translateOc2AuthMethods(
  providers: any[],
  integrations: any[],
): Record<string, Array<Record<string, unknown>>> {
  const out: Record<string, Array<Record<string, unknown>>> = {};
  for (const integration of integrations) {
    const methods = (Array.isArray(integration?.methods) ? integration.methods : [])
      .filter((method: any) => method?.type === "oauth" || method?.type === "key")
      .map((method: any) => ({
        type: method.type === "key" ? "api" : "oauth",
        label: method.label ?? (method.type === "key" ? "API key" : "Sign in"),
        ...(method.form ? { prompts: formFieldPrompts(method.form) } : {}),
      }));
    if (!methods.length) continue;
    // Integrations normally map 1:1 to a provider via `integrationID`, but some
    // older configs use the integration id as the provider id.
    const served = providers.filter(
      (provider) => provider?.id === integration.id || provider?.integrationID === integration.id,
    );
    if (served.length) {
      for (const provider of served) out[provider.id] = methods;
    } else {
      out[integration.id] = methods;
    }
  }
  return out;
}
