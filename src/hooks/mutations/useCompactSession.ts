import { useMutation, useQueryClient } from "@tanstack/react-query";
import posthog from "posthog-js/dist/module.full.no-external.js";

import { analyticsProperties, errorAnalyticsProperties } from "@/lib/analytics";
import { qk } from "@/lib/queryKeys";
import { splitModelKey } from "@/lib/splitModelKey";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { usePreferences } from "@/providers/PreferencesProvider";

/**
 * Summarize the active session through OpenCode's own compaction endpoint.
 *
 * This is the manual equivalent of automatic compaction: older messages are
 * replaced by a summary, and the engine emits `session.compacted`. The event
 * already refreshes the message cache, but invalidating here also covers a
 * response that arrives before the event.
 */
export function useCompactSession() {
  const { client } = useOpenCodeClient();
  const { activeSessionId } = useActiveSession();
  const { selectedModel } = usePreferences();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<void> => {
      if (!client || !activeSessionId) throw new Error("No client or session");
      if (!selectedModel) throw new Error("Select a model before compacting");
      const [providerID, modelID] = splitModelKey(selectedModel);
      if (!providerID || !modelID) throw new Error("Select a model before compacting");

      const result = await client.session.summarize(
        { sessionID: activeSessionId, providerID, modelID },
        { throwOnError: true },
      );
      if (!result.data) throw new Error("Nothing to compact yet");

      await queryClient.invalidateQueries({ queryKey: qk.messages(activeSessionId) });
    },
    onSuccess: () => {
      posthog.capture(
        "session_compacted",
        analyticsProperties("sessions", { outcome: "success", source: "manual" }),
      );
    },
    onError: (error) => {
      posthog.capture(
        "session_compacted",
        errorAnalyticsProperties("sessions", "compaction", error, { source: "manual" }),
      );
    },
  });
}
