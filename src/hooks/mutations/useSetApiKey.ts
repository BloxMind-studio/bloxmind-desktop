import type {
  OpencodeClient,
  ProviderAuthMethod,
  ProviderListResponse,
} from "@opencode-ai/sdk/v2/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import posthog from "posthog-js/dist/module.full.no-external.js";

import { analyticsProperties, detailedAnalyticsProperties } from "@/lib/analytics";
import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

type ProvidersData = ProviderListResponse & {
  authMethods?: Record<string, ProviderAuthMethod[]>;
};

/**
 * How many times to read the provider list back after a credential change.
 * Disposing the engine instance reinitializes it lazily, so the first response
 * can still describe the credential that was just removed.
 */
const PROVIDER_REFRESH_ATTEMPTS = 4;
const PROVIDER_REFRESH_INTERVAL_MS = 100;

/**
 * Read the provider list again after `instance.dispose`, until `settled`
 * accepts it or the attempts run out.
 *
 * Returns null when the engine never confirmed the change: that list is known
 * to be stale, and writing it would undo the optimistic update the caller made.
 */
async function refreshProviders(
  client: OpencodeClient,
  settled: (data: ProvidersData) => boolean,
): Promise<ProvidersData | null> {
  await client.instance.dispose({}, { throwOnError: true });
  // First call after dispose triggers server reinitialization; it may return
  // the state from before the dispose, so its result is not used.
  await client.provider.list({}, { throwOnError: true });

  for (let attempt = 0; attempt < PROVIDER_REFRESH_ATTEMPTS; attempt += 1) {
    const [providers, auth] = await Promise.all([
      client.provider.list({}, { throwOnError: true }),
      client.provider.auth({}, { throwOnError: true }).catch(() => ({ data: undefined })),
    ]);
    if (providers.data) {
      const data = auth.data ? { ...providers.data, authMethods: auth.data } : providers.data;
      if (settled(data)) return data;
    }
    if (attempt < PROVIDER_REFRESH_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, PROVIDER_REFRESH_INTERVAL_MS));
    }
  }
  return null;
}

/**
 * Drop a removed credential from the cached provider list right away. Removing
 * a Zen key leaves the built-in free models connected, so Zen keeps its row and
 * only stops reading as an account.
 */
function withoutProvider(data: ProvidersData, providerID: string): ProvidersData {
  if (providerID === "opencode") {
    return {
      ...data,
      all: data.all.map((provider) =>
        provider.id === "opencode" ? { ...provider, source: "custom" as const } : provider,
      ),
    };
  }
  return {
    ...data,
    connected: data.connected.filter((id) => id !== providerID),
  };
}

/** Whether a provider list already reflects the removed credential. */
function disconnectSettled(data: ProvidersData, providerID: string): boolean {
  if (providerID === "opencode") {
    // Removing a Zen key must leave Zen itself in place with its free models.
    const zen = data.all.find((provider) => provider.id === "opencode");
    return zen !== undefined && zen.source !== "api";
  }
  return !data.connected.includes(providerID);
}

export function useSetApiKey() {
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ providerID, key }: { providerID: string; key: string }) => {
      if (!client) throw new Error("No client");
      await client.auth.set({ providerID, auth: { type: "api", key } }, { throwOnError: true });

      // The key is saved at this point. A failed refresh must not report the save
      // as failed, so fall back to refetching the provider list.
      try {
        const refreshed = await refreshProviders(client, (data) =>
          data.connected.includes(providerID),
        );
        if (refreshed) {
          await queryClient.cancelQueries({ queryKey: qk.providers });
          queryClient.setQueryData(qk.providers, refreshed);
        } else {
          await queryClient.invalidateQueries({ queryKey: qk.providers });
        }
      } catch {
        await queryClient.invalidateQueries({ queryKey: qk.providers });
      }

      posthog.capture(
        "provider_connected",
        analyticsProperties("providers", {
          outcome: "success",
          method: "api_key",
          ...detailedAnalyticsProperties({ provider: providerID }),
        }),
      );
    },
  });
}

export function useDisconnectProvider() {
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (providerID: string) => {
      if (!client) throw new Error("No client");
      await client.auth.remove({ providerID }, { throwOnError: true });

      // The credential is gone at this point. The engine's list can keep
      // reporting the provider until it finishes reinitializing, so drop it from
      // the cache now and only replace that with a list that agrees.
      await queryClient.cancelQueries({ queryKey: qk.providers });
      queryClient.setQueryData<ProvidersData>(qk.providers, (current) =>
        current ? withoutProvider(current, providerID) : current,
      );

      // A failed refresh must not report the disconnect as failed. The
      // optimistic cache is already correct, and the next reconcile refetches.
      try {
        const refreshed = await refreshProviders(client, (data) =>
          disconnectSettled(data, providerID),
        );
        if (refreshed) {
          await queryClient.cancelQueries({ queryKey: qk.providers });
          queryClient.setQueryData(qk.providers, refreshed);
        }
      } catch {
        // Keep the optimistic state rather than restoring a stale list.
      }
      posthog.capture(
        "provider_disconnected",
        analyticsProperties("providers", {
          outcome: "success",
          ...detailedAnalyticsProperties({ provider: providerID }),
        }),
      );
      return providerID;
    },
  });
}
