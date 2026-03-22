import { usePreferences } from "@/providers/PreferencesProvider";

export function useDismissWelcome() {
  const { dismissWelcome } = usePreferences();
  return dismissWelcome;
}
