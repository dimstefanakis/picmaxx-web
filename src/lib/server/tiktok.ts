import { createHash } from "node:crypto";

import {
  TIKTOK_PIXEL_ID,
  createTikTokCommerceProperties,
  type TikTokEventName,
  type TikTokEventProperties,
} from "@/lib/tiktok";
import { requiredEnv } from "@/lib/server/env";

const TIKTOK_EVENTS_API_URL =
  "https://business-api.tiktok.com/open_api/v1.3/event/track/";
const TIKTOK_EVENTS_API_TIMEOUT_MS = 3_000;

export type TikTokEventInput = {
  eventName: TikTokEventName;
  eventId: string;
  sourceUrl: string;
  referrer?: string;
  userAgent: string;
  ipAddress: string;
  email?: string;
  ttp?: string;
  ttclid?: string;
  properties: TikTokEventProperties;
  eventTime?: number;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function truncate(value: string, maxLength = 4000) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

export function buildTikTokEventsApiPayload(
  input: TikTokEventInput,
  testEventCode?: string,
) {
  const email = input.email?.trim().toLowerCase() ?? "";
  const hashedEmail = email ? sha256(email) : "";

  return {
    event_source: "web",
    event_source_id: TIKTOK_PIXEL_ID,
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
    data: [
      {
        event: input.eventName,
        event_time: input.eventTime ?? Math.floor(Date.now() / 1000),
        event_id: input.eventId,
        user: {
          ...(hashedEmail ? { email: [hashedEmail] } : {}),
          ...(hashedEmail ? { external_id: [hashedEmail] } : {}),
          ...(input.ttp ? { ttp: input.ttp } : {}),
          ...(input.ttclid ? { ttclid: input.ttclid } : {}),
          ...(input.ipAddress ? { ip: input.ipAddress } : {}),
          ...(input.userAgent ? { user_agent: input.userAgent } : {}),
        },
        page: {
          url: input.sourceUrl,
          ...(input.referrer ? { referrer: input.referrer } : {}),
        },
        properties: input.properties,
      },
    ],
  };
}

async function sendTikTokEvent(input: TikTokEventInput) {
  const payload = buildTikTokEventsApiPayload(
    input,
    process.env.TIKTOK_TEST_EVENT_CODE,
  );
  const response = await fetch(TIKTOK_EVENTS_API_URL, {
    method: "POST",
    signal: AbortSignal.timeout(TIKTOK_EVENTS_API_TIMEOUT_MS),
    headers: {
      "Access-Token": requiredEnv("TIKTOK_ACCESS_TOKEN"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body: unknown = text;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // Keep the raw response text for diagnostics.
    }
  }

  const apiCode =
    body && typeof body === "object" && "code" in body
      ? (body as { code?: unknown }).code
      : undefined;
  const ok =
    response.ok &&
    (apiCode === undefined || apiCode === 0 || apiCode === "0");
  const summary = truncate(
    typeof body === "string" ? body : JSON.stringify(body ?? {}),
  );

  if (!ok) {
    throw new Error(`TikTok Events API ${response.status}: ${summary}`);
  }

  return {
    ok,
    status: response.status,
    body,
    summary,
  };
}

export function sendTikTokViewContentEvent(
  input: Omit<TikTokEventInput, "eventName">,
) {
  return sendTikTokEvent({ ...input, eventName: "ViewContent" });
}

function sendTikTokCommerceEvent({
  eventName,
  email,
  eventId,
  sourceUrl,
  referrer,
  userAgent,
  ipAddress,
  ttp,
  ttclid,
  packageId,
  contentName,
  amountCents,
  currency,
}: {
  eventName: "InitiateCheckout" | "Purchase";
  email: string;
  eventId: string;
  sourceUrl: string;
  referrer: string;
  userAgent: string;
  ipAddress: string;
  ttp: string;
  ttclid: string;
  packageId: string;
  contentName: string;
  amountCents: number;
  currency: string;
}) {
  return sendTikTokEvent({
    eventName,
    email,
    eventId,
    sourceUrl,
    referrer,
    userAgent,
    ipAddress,
    ttp,
    ttclid,
    properties: createTikTokCommerceProperties({
      contentId: packageId,
      contentName,
      value: amountCents / 100,
      currency,
    }),
  });
}

export function sendTikTokInitiateCheckoutEvent(
  input: Omit<
    Parameters<typeof sendTikTokCommerceEvent>[0],
    "eventName"
  >,
) {
  return sendTikTokCommerceEvent({
    ...input,
    eventName: "InitiateCheckout",
  });
}

export function sendTikTokPurchaseEvent(
  input: Omit<
    Parameters<typeof sendTikTokCommerceEvent>[0],
    "eventName"
  >,
) {
  return sendTikTokCommerceEvent({ ...input, eventName: "Purchase" });
}
