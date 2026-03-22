import { memo, useCallback } from "react";
import { usePreferences } from "@/providers/PreferencesProvider";

const ChatSetup = memo(function ChatSetup() {
  const { dismissWelcome } = usePreferences();
  const handleDismiss = useCallback(() => dismissWelcome(), [dismissWelcome]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="flex w-full max-w-sm flex-col items-center text-center animate-in fade-in slide-in-from-bottom-3 duration-500">
        <img src="/bloxbot-logo.svg" alt="" className="mx-auto h-14 w-14" />
        <p className="mt-3 font-serif text-lg italic text-foreground">bloxbot</p>

        <h2 className="mt-8 font-serif text-4xl italic text-foreground">Ready to build?</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Your AI co-pilot for Roblox Studio is warming up in the background.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Make sure Roblox Studio's built-in MCP server is enabled in Assistant settings.
        </p>

        <button
          onClick={handleDismiss}
          className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-foreground px-6 text-sm font-medium text-background transition-opacity hover:opacity-90 active:scale-[0.98]"
        >
          Get Started
        </button>
      </div>
    </div>
  );
});

export default ChatSetup;
