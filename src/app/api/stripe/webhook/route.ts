import Stripe from "stripe";

import {
  PHOTO_TEST_CURRENCY,
  PHOTO_TEST_PRICE_CENTS,
} from "@/lib/photo-test";
import { updatePaidTestRecord } from "@/lib/server/airtable";
import { requiredEnv } from "@/lib/server/env";
import { sendMetaPurchaseEvent } from "@/lib/server/meta";
import { stripeClient } from "@/lib/server/stripe";

export const runtime = "nodejs";

function fieldString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function clientIp(headers: Headers) {
  const forwardedFor = headers.get("x-forwarded-for") ?? "";
  return forwardedFor.split(",")[0]?.trim() ?? "";
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ ok: false, error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await request.text();
  let event: Stripe.Event;

  try {
    event = stripeClient().webhooks.constructEvent(
      rawBody,
      signature,
      requiredEnv("STRIPE_WEBHOOK_SECRET"),
    );
  } catch {
    return Response.json({ ok: false, error: "Invalid signature" }, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return Response.json({ ok: true, ignored: true });
  }

  const session = event.data.object;
  const orderId = session.metadata?.orderId;
  const airtableRecordId = session.metadata?.airtableRecordId;
  if (!orderId || !airtableRecordId) {
    return Response.json({ ok: false, error: "Missing order metadata" }, { status: 400 });
  }

  const paidAt = new Date().toISOString();
  await updatePaidTestRecord(airtableRecordId, {
    Status: "paid",
    "Payment Status": session.payment_status ?? "paid",
    "Stripe Session ID": session.id,
    "Paid At": paidAt,
  });

  const email =
    fieldString(session.customer_details?.email) ||
    fieldString(session.customer_email) ||
    fieldString(session.metadata?.email);
  if (email) {
    try {
      const metaResponse = await sendMetaPurchaseEvent({
        email,
        eventId: orderId,
        sourceUrl: fieldString(session.metadata?.sourceUrl),
        userAgent: fieldString(session.metadata?.userAgent) || (request.headers.get("user-agent") ?? ""),
        ipAddress: fieldString(session.metadata?.ipAddress) || clientIp(request.headers),
        fbp: fieldString(session.metadata?.fbp),
        fbc: fieldString(session.metadata?.fbc),
        packageId: fieldString(session.metadata?.packageId),
        amountCents: PHOTO_TEST_PRICE_CENTS,
        currency: PHOTO_TEST_CURRENCY,
      });

      await updatePaidTestRecord(airtableRecordId, {
        "Meta CAPI Status": metaResponse.ok
          ? `ok ${metaResponse.status}`
          : `error ${metaResponse.status}`,
        "Meta CAPI Response": metaResponse.summary,
      }).catch((error) => console.error(error));
    } catch (error) {
      console.error(error);
      await updatePaidTestRecord(airtableRecordId, {
        "Meta CAPI Status": "error",
        "Meta CAPI Response": error instanceof Error ? error.message : "Unknown Meta CAPI error",
      }).catch((updateError) => console.error(updateError));
    }
  }

  return Response.json({ ok: true });
}
