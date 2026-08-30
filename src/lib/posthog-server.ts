import { createHash } from "node:crypto";

import { PostHog, type EventMessage } from "posthog-node";

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

export async function capturePostHogServerEvent(message: EventMessage) {
  try {
    await getPostHogClient().captureImmediate(message);
  } catch (error) {
    console.error("Could not send PostHog server event.", error);
  }
}

export function postHogEventUuid(namespace: string, id: string) {
  const bytes = createHash("sha256")
    .update(`${namespace}:${id}`)
    .digest()
    .subarray(0, 16);

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
