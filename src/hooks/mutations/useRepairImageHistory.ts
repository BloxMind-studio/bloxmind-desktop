import { useMutation, useQueryClient } from "@tanstack/react-query";
import { findImageParts } from "@/lib/imageSupport";
import type { Part } from "@/lib/opencode";
import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

/**
 * Removes every image payload from the active session's history.
 *
 * A screenshot that a text-only model cannot read fails every later request,
 * including "continue", because the image stays in the conversation and is
 * re-sent each turn. Deleting the image file part, or the image attachments on
 * a completed tool part, repairs the history without touching Studio or files.
 */
export function useRepairImageHistory() {
  const { client } = useOpenCodeClient();
  const { activeSessionId } = useActiveSession();
  const queryClient = useQueryClient();

  return useMutation<number, Error, void>({
    mutationFn: async () => {
      if (!client || !activeSessionId) throw new Error("No client or session");

      const result = await client.session.messages(
        { sessionID: activeSessionId },
        { throwOnError: true },
      );
      let removed = 0;
      for (const { messageID, part, imageCount } of findImageParts(result.data ?? [])) {
        if (part.type === "file") {
          await client.part.delete(
            { sessionID: activeSessionId, messageID, partID: part.id },
            { throwOnError: true },
          );
        } else if (part.type === "tool" && part.state.status === "completed") {
          const attachments = (part.state.attachments ?? []).filter(
            (file) => !file.mime.startsWith("image/"),
          );
          const repaired = {
            ...part,
            state: { ...part.state, attachments },
          } as Part;
          try {
            await client.part.update(
              { sessionID: activeSessionId, messageID, partID: part.id, part: repaired },
              { throwOnError: true },
            );
          } catch {
            // Some engines reject updates to completed tool parts. Dropping the
            // whole tool record is a heavier but reliable way to remove images.
            await client.part.delete(
              { sessionID: activeSessionId, messageID, partID: part.id },
              { throwOnError: true },
            );
          }
        }
        removed += imageCount;
      }

      await queryClient.invalidateQueries({ queryKey: qk.messages(activeSessionId) });
      return removed;
    },
  });
}
