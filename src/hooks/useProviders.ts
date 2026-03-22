import { useQuery } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import type { AuthMethods, ModelInfo, ProviderInfo } from "@/types";

interface ProvidersData {
  all: Array<{
    id: string;
    name: string;
    env: string[];
    models: Record<string, { id: string; name: string; status?: string; variants?: unknown }>;
  }>;
  connected: string[];
  default?: Record<string, string>;
  authMethods?: AuthMethods;
}

export function useProvidersQuery() {
  const { client } = useOpenCodeClient();

  return useQuery<ProvidersData>({
    queryKey: qk.providers,
    queryFn: async () => {
      if (!client) throw new Error("No client");
      const [provRes, authRes] = await Promise.all([
        client.provider.list({}),
        client.provider.auth({}).catch(() => ({ data: undefined })),
      ]);
      if (!provRes.data) throw new Error("No provider data");
      const merged = authRes.data ? { ...provRes.data, authMethods: authRes.data } : provRes.data;
      return merged as ProvidersData;
    },
    enabled: !!client,
    // Allow refetches when invalidated (after auth changes)
    staleTime: 0,
  });
}

export function useAllProviders(): ProviderInfo[] {
  const { data } = useProvidersQuery();
  if (!data?.all) return [];
  return data.all.map((p) => ({ id: p.id, name: p.name, env: p.env }));
}

export function useConnectedProviders(): string[] {
  const { data } = useProvidersQuery();
  return data?.connected ?? [];
}

export function useAllModels(): ModelInfo[] {
  const { data } = useProvidersQuery();
  if (!data?.all) return [];
  const models: ModelInfo[] = [];
  for (const provider of data.all) {
    for (const model of Object.values(provider.models)) {
      models.push({
        id: model.id,
        name: model.name,
        providerId: provider.id,
        providerName: provider.name,
        status: model.status as ModelInfo["status"],
        variants: model.variants as ModelInfo["variants"],
      });
    }
  }
  return models;
}

export function useAuthMethods(): AuthMethods {
  const { data } = useProvidersQuery();
  return (data as ProvidersData & { authMethods?: AuthMethods })?.authMethods ?? {};
}
