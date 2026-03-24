import { PostHogProvider } from "@posthog/react";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const POSTHOG_API_KEY = "phc_bOlMECnl02VBjOp2Y8PNOD36gSBmAuekirxhPKxjbEz";
const POSTHOG_API_HOST = "https://eu.i.posthog.com";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <PostHogProvider
      apiKey={POSTHOG_API_KEY}
      options={{
        api_host: POSTHOG_API_HOST,
        defaults: "2026-01-30",
        advanced_disable_toolbar_metrics: true,
        disable_session_recording: true,
      }}
    >
      <App />
    </PostHogProvider>
  </React.StrictMode>,
);
