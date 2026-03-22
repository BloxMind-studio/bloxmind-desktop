import { useMutation, useQueryClient } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";
import { capture } from "@/lib/telemetry";
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
      if (res.data.method === "code") {
        window.open(res.data.url, "_blank");
      }
      return { method: res.data.method, instructions: res.data.instructions, url: res.data.url };
    },
  });
}

export function useCompleteOAuth() {
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();

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
        capture("provider_connected", { provider: providerID, method: "oauth" });
      }
      return res.data === true;
    },
  });
}
