import { usePostHog } from "@posthog/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

export function useStartOAuth() {
  const { client } = useOpenCodeClient();

  return useMutation({
    mutationFn: async ({
      providerID,
      methodIndex,
    }: {
      providerID: string;
      methodIndex: number;
    }) => {
      if (!client) throw new Error("No client");
      const res = await client.provider.oauth.authorize({ providerID, method: methodIndex });
      if (!res.data) return undefined;
      // Always open the URL — in a Tauri app the sidecar can't open a browser itself
      if (res.data.url) {
        await openUrl(res.data.url);
      }
      return { method: res.data.method, instructions: res.data.instructions, url: res.data.url };
    },
  });
}

export function useCompleteOAuth() {
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();
  const posthog = usePostHog();

  return useMutation({
    mutationFn: async ({
      providerID,
      methodIndex,
      code,
    }: {
      providerID: string;
      methodIndex: number;
      code?: string;
    }) => {
      if (!client) throw new Error("No client");
      const res = await client.provider.oauth.callback({
        providerID,
        method: methodIndex,
        ...(code ? { code } : {}),
      });
      await client.instance.dispose();

      await client.provider.list({});
      const [provRes, authRes] = await Promise.all([
        client.provider.list({}),
        client.provider.auth({}).catch(() => ({ data: undefined })),
      ]);
      if (provRes.data) {
        const merged = authRes.data ? { ...provRes.data, authMethods: authRes.data } : provRes.data;
        queryClient.setQueryData(qk.providers, merged);
      }

      if (res.data === true) {
        posthog.capture("provider_connected", { provider: providerID, method: "oauth" });
      }
      return res.data === true;
    },
  });
}
