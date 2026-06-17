import { NextRequest } from "next/server";
import { createHash } from "node:crypto";

const AIRTABLE_BASE_ID = "apptoTG8pT2MzzdiM";
const AIRTABLE_TABLE_ID = "tbl7KJaUAxqNqPxWs";
const META_PIXEL_ID = "1532157435278333";
const META_API_VERSION = process.env.META_API_VERSION ?? "v23.0";

type WaitlistPayload = {
  email?: string;
  audience?: string;
  eventId?: string;
  sourceUrl?: string;
  referrer?: string;
  fbp?: string;
  fbc?: string;
};

type AirtableRecord = {
  id: string;
};

function jsonError(message: string, status: number) {
  return Response.json({ ok: false, error: message }, { status });
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function truncate(value: string, maxLength = 4000) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

async function airtableRequest<T>(
  path: string,
  init: RequestInit,
  apiKey: string,
) {
  const response = await fetch(`https://api.airtable.com/v0/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(
      `Airtable ${response.status}: ${truncate(JSON.stringify(data ?? text))}`,
    );
  }

  return data as T;
}

async function createAirtableRecord(
  fields: Record<string, string>,
  apiKey: string,
) {
  return airtableRequest<AirtableRecord>(
    `${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`,
    {
      method: "POST",
      body: JSON.stringify({ fields }),
    },
    apiKey,
  );
}

async function updateAirtableRecord(
  recordId: string,
  fields: Record<string, string>,
  apiKey: string,
) {
  return airtableRequest<AirtableRecord>(
    `${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${recordId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ fields }),
    },
    apiKey,
  );
}

async function sendMetaLeadEvent({
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
  const accessToken = requireEnv("META_ACCESS_TOKEN");
  const payload = {
    data: [
      {
        event_name: "Lead",
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: "website",
        event_source_url: sourceUrl,
        user_data: {
          em: [sha256(email)],
          client_ip_address: ipAddress,
          client_user_agent: userAgent,
          fbp: fbp || undefined,
          fbc: fbc || undefined,
        },
        custom_data: {
          content_name: "PicMaxx Waitlist",
          lead_type: "male_waitlist",
        },
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
  };
}

export async function POST(request: NextRequest) {
  let payload: WaitlistPayload;

  try {
    payload = (await request.json()) as WaitlistPayload;
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const email = normalizeEmail(payload.email ?? "");
  const audience = payload.audience === "male" ? "male" : "";
  const eventId = payload.eventId?.trim() || crypto.randomUUID();
  const sourceUrl = payload.sourceUrl?.trim() || request.nextUrl.origin;
  const referrer = payload.referrer?.trim() || "";
  const fbp = payload.fbp?.trim() || "";
  const fbc = payload.fbc?.trim() || "";
  const userAgent = request.headers.get("user-agent") ?? "";
  const forwardedFor = request.headers.get("x-forwarded-for") ?? "";
  const ipAddress = forwardedFor.split(",")[0]?.trim() ?? "";

  if (!email || !isValidEmail(email)) {
    return jsonError("Enter a valid email.", 400);
  }

  if (!audience) {
    return jsonError("Invalid audience.", 400);
  }

  let airtableKey: string;
  try {
    airtableKey = requireEnv("AIRTABLE_SECRET_KEY");
  } catch {
    return jsonError("Server is missing waitlist configuration.", 500);
  }

  let record: AirtableRecord;
  try {
    record = await createAirtableRecord(
      {
        Email: email,
        Audience: audience,
        "Event ID": eventId,
        "Source URL": sourceUrl,
        Referrer: referrer,
        FBP: fbp,
        FBC: fbc,
        "User Agent": userAgent,
        "Meta CAPI Status": "pending",
      },
      airtableKey,
    );
  } catch (error) {
    console.error(error);
    return jsonError("Could not save waitlist signup.", 502);
  }

  try {
    const metaResponse = await sendMetaLeadEvent({
      email,
      eventId,
      sourceUrl,
      userAgent,
      ipAddress,
      fbp,
      fbc,
    });

    await updateAirtableRecord(
      record.id,
      {
        "Meta CAPI Status": metaResponse.ok
          ? `ok ${metaResponse.status}`
          : `error ${metaResponse.status}`,
        "Meta CAPI Response": truncate(JSON.stringify(metaResponse.body ?? {})),
      },
      airtableKey,
    ).catch((error) => console.error(error));
  } catch (error) {
    console.error(error);
    await updateAirtableRecord(
      record.id,
      {
        "Meta CAPI Status": "error",
        "Meta CAPI Response": truncate(
          error instanceof Error ? error.message : "Unknown Meta CAPI error",
        ),
      },
      airtableKey,
    ).catch((updateError) => console.error(updateError));
  }

  return Response.json({ ok: true, eventId });
}
