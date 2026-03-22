import type { PermissionRequest } from "@opencode-ai/sdk/v2/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

export function useReplyPermission() {
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      requestID,
      reply,
    }: {
      requestID: string;
      reply: "once" | "always" | "reject";
    }) => {
      if (!client) throw new Error("No client");
      await client.permission.reply({ requestID, reply });
    },
    onSuccess: () => {
      queryClient.setQueryData<PermissionRequest | null>(qk.permissions, null);
    },
  });
}
