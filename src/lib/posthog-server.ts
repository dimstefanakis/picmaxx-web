import { PostHog } from "posthog-node";

let posthogClient: PostHog | null = null;

function posthogKey() {
  return (
    process.env.NEXT_PUBLIC_POSTHOG_KEY ??
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
  );
}

export function getPostHogClient() {
  if (!posthogClient) {
    const key = posthogKey();
    if (!key) {
      throw new Error(
        "Missing NEXT_PUBLIC_POSTHOG_KEY or NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN",
      );
    }

    posthogClient = new PostHog(key, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return posthogClient;
}

export async function shutdownPostHog() {
  if (posthogClient) {
    await posthogClient.shutdown();
  }
}
