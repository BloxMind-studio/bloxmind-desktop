import type { PermissionRequest } from "@opencode-ai/sdk/v2/client";
import { useQuery } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";

export function useActivePermission(): PermissionRequest | null {
  const { data } = useQuery<PermissionRequest | null>({
    queryKey: qk.permissions,
    enabled: false,
  });
  return data ?? null;
}
