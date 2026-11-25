import { useEffect } from "react";
import { useChatStudioUse } from "@/hooks/useMessages";
import { useStudioTargetOptional } from "@/providers/StudioTargetProvider";

/**
 * Tells the Studio target provider what a chat's own messages say about Studio.
 * Kept out of the provider so it can run where React Query is available, and
 * tests of the provider itself don't need a QueryClient.
 */
export default function StudioUseReporter() {
  const studioTarget = useStudioTargetOptional();
  const studioUse = useChatStudioUse();

  useEffect(() => {
    if (studioUse) studioTarget?.reportStudioUse(studioUse);
  }, [studioTarget, studioUse]);

  return null;
}
