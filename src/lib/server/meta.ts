import { createHash } from "node:crypto";

import { requiredEnv } from "@/lib/server/env";

const META_PIXEL_ID = "1532157435278333";
const META_API_VERSION = process.env.META_API_VERSION ?? "v23.0";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function truncate(value: string, maxLength = 4000) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function fbcFromUrl(sourceUrl: string) {
  try {
    const fbclid = new URL(sourceUrl).searchParams.get("fbclid");
    return fbclid ? `fb.1.${Date.now()}.${fbclid}` : "";
  } catch {
    return "";
  }
}

export async function sendMetaPurchaseEvent({
  email,
  eventId,
  sourceUrl,
  userAgent,
  ipAddress,
  fbp,
  fbc,
  packageId,
  amountCents,
  currency,
}: {
  email: string;
  eventId: string;
  sourceUrl: string;
  userAgent: string;
  ipAddress: string;
  fbp: string;
  fbc: string;
  packageId: string;
  amountCents: number;
  currency: string;
}) {
  return sendMetaCommerceEvent({
    eventName: "Purchase",
    email,
    eventId,
    sourceUrl,
    userAgent,
    ipAddress,
    fbp,
    fbc,
    packageId,
    amountCents,
    currency,
  });
}

export async function sendMetaPageViewEvent({
  eventId,
  sourceUrl,
  userAgent,
  ipAddress,
  fbp,
  fbc,
}: {
  eventId: string;
  sourceUrl: string;
  userAgent: string;
  ipAddress: string;
  fbp: string;
  fbc: string;
}) {
  return sendMetaEvent({
    eventName: "PageView",
    eventId,
    sourceUrl,
    userAgent,
    ipAddress,
    fbp,
    fbc,
  });
}

export async function sendMetaLeadEvent({
  email,
  eventId,
  sourceUrl,
  userAgent,
  ipAddress,
  fbp,
  fbc,
}: {
  email: string;
  eventId: string;
  sourceUrl: string;
  userAgent: string;
  ipAddress: string;
  fbp: string;
  fbc: string;
}) {
  return sendMetaEvent({
    eventName: "Lead",
    eventId,
    sourceUrl,
    userAgent,
    ipAddress,
    fbp,
    fbc,
    email,
    customData: {
      content_name: "PicMaxx Waitlist",
      lead_type: "male_waitlist",
    },
  });
}

export async function sendMetaInitiateCheckoutEvent({
  email,
  eventId,
  sourceUrl,
  userAgent,
  ipAddress,
  fbp,
  fbc,
  packageId,
  amountCents,
  currency,
}: {
  email: string;
  eventId: string;
  sourceUrl: string;
  userAgent: string;
  ipAddress: string;
  fbp: string;
  fbc: string;
  packageId: string;
  amountCents: number;
  currency: string;
}) {
  return sendMetaCommerceEvent({
    eventName: "InitiateCheckout",
    email,
    eventId,
    sourceUrl,
    userAgent,
    ipAddress,
    fbp,
    fbc,
    packageId,
    amountCents,
    currency,
  });
}

async function sendMetaCommerceEvent({
  eventName,
  email,
  eventId,
  sourceUrl,
  userAgent,
  ipAddress,
  fbp,
  fbc,
  packageId,
  amountCents,
  currency,
}: {
  eventName: "InitiateCheckout" | "Purchase";
  email: string;
  eventId: string;
  sourceUrl: string;
  userAgent: string;
  ipAddress: string;
  fbp: string;
  fbc: string;
  packageId: string;
  amountCents: number;
  currency: string;
}) {
  return sendMetaEvent({
    eventName,
    eventId,
    sourceUrl,
    userAgent,
    ipAddress,
    fbp,
    fbc,
    email,
    customData: {
      content_name: "Picmaxx Paid Photo Test",
      content_type: packageId,
      currency: currency.toUpperCase(),
      value: amountCents / 100,
    },
  });
}

async function sendMetaEvent({
  eventName,
  eventId,
  sourceUrl,
  userAgent,
  ipAddress,
  fbp,
  fbc,
  email,
  customData,
}: {
  eventName: "PageView" | "Lead" | "InitiateCheckout" | "Purchase";
  eventId: string;
  sourceUrl: string;
  userAgent: string;
  ipAddress: string;
  fbp: string;
  fbc: string;
  email?: string;
  customData?: Record<string, string | number>;
}) {
  const accessToken = requiredEnv("META_ACCESS_TOKEN");
  const effectiveFbc = fbc || fbcFromUrl(sourceUrl);
  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: "website",
        event_source_url: sourceUrl,
        user_data: {
          ...(email ? { em: [sha256(email)] } : {}),
          ...(email ? { external_id: [sha256(email)] } : {}),
          client_ip_address: ipAddress,
          client_user_agent: userAgent,
          fbp: fbp || undefined,
          fbc: effectiveFbc || undefined,
        },
        ...(customData ? { custom_data: customData } : {}),
      },
    ],
    ...(process.env.META_TEST_EVENT_CODE
      ? { test_event_code: process.env.META_TEST_EVENT_CODE }
      : {}),
  };

  const response = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  return {
    ok: response.ok,
    status: response.status,
    body: data,
    summary: truncate(JSON.stringify(data ?? {})),
  };
}
