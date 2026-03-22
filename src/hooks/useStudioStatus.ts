import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

interface StudioStatusResult {
  status: "unknown" | "connected" | "disconnected" | "failed" | "disabled" | "needs_auth";
  error: string | null;
}

export function useStudioStatus() {
  const { status } = useOpenCodeClient();

  const { data } = useQuery<StudioStatusResult>({
    queryKey: qk.studioStatus,
    queryFn: () => invoke<StudioStatusResult>("poll_studio_status"),
    enabled: status === "Running",
    refetchInterval: (query) => (query.state.data?.status === "connected" ? 5000 : 500),
  });

  return {
    studioStatus: data?.status ?? "unknown",
    studioError: data?.error ?? null,
  };
}
