import { NextRequest } from "next/server";
import { getPostHogClient } from "@/lib/posthog-server";
import { sendMetaLeadEvent } from "@/lib/server/meta";

const AIRTABLE_BASE_ID = "apptoTG8pT2MzzdiM";
const AIRTABLE_TABLE_ID = "tbl7KJaUAxqNqPxWs";

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

  const posthog = getPostHogClient();
  posthog.identify({ distinctId: email, properties: { email } });
  posthog.capture({
    distinctId: email,
    event: "waitlist_signup_submitted",
    properties: {
      source_url: sourceUrl,
      audience,
    },
  });

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
