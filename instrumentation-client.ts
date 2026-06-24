import posthog from "posthog-js";

const posthogKey =
  process.env.NEXT_PUBLIC_POSTHOG_KEY ??
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

if (posthogKey) {
  posthog.init(posthogKey, {
    api_host: "/ingest",
    ui_host: "https://us.posthog.com",
    defaults: "2025-05-24",
    capture_exceptions: true,
    disable_session_recording: false,
    session_recording: {
      maskAllInputs: true,
    },
    debug: process.env.NODE_ENV === "development",
  });
}
