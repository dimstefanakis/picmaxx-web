import Stripe from "stripe";
import { after } from "next/server";

import {
  PHOTO_TEST_CURRENCY,
  PHOTO_TEST_PRICE_CENTS,
  isPhotoTestPackageId,
  photoTestPackages,
} from "@/lib/photo-test";
import { updatePaidTestRecord } from "@/lib/server/airtable";
import { requiredEnv, siteUrl } from "@/lib/server/env";
import { sendMetaPurchaseEvent } from "@/lib/server/meta";
import { getPostHogClient } from "@/lib/posthog-server";
import { stripeClient } from "@/lib/server/stripe";
import { sendTikTokPurchaseEvent } from "@/lib/server/tiktok";
import { joinTikTokClickIdFromMetadata } from "@/lib/tiktok";

export const runtime = "nodejs";
export const maxDuration = 35;

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

  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded"
  ) {
    return Response.json({ ok: true, ignored: true });
  }

  const session = event.data.object;
  if (session.payment_status !== "paid") {
    return Response.json({
      ok: true,
      ignored: true,
      reason: "payment_not_paid",
    });
  }

  const orderId = session.metadata?.orderId;
  const airtableRecordId = session.metadata?.airtableRecordId;
  if (!orderId || !airtableRecordId) {
    return Response.json({ ok: false, error: "Missing order metadata" }, { status: 400 });
  }

  const paidAt = new Date().toISOString();
  const purchaseEmail =
    fieldString(session.customer_details?.email) ||
    fieldString(session.customer_email) ||
    fieldString(session.metadata?.email);
  const packageId = fieldString(session.metadata?.packageId);
  await updatePaidTestRecord(airtableRecordId, {
    Status: "paid",
    "Payment Status": session.payment_status ?? "paid",
    "Stripe Session ID": session.id,
    "Paid At": paidAt,
    ...(purchaseEmail ? { Email: purchaseEmail } : {}),
  });

  getPostHogClient().capture({
    distinctId: purchaseEmail || orderId,
    event: "photo_test_purchase_confirmed",
    properties: {
      order_id: orderId,
      stripe_session_id: session.id,
      package_id: packageId,
      amount_cents: PHOTO_TEST_PRICE_CENTS,
      currency: PHOTO_TEST_CURRENCY,
    },
  });

  const email = purchaseEmail;
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
        packageId,
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

  after(async () => {
    try {
      await sendTikTokPurchaseEvent({
        email,
        eventId: orderId,
        sourceUrl: fieldString(session.metadata?.sourceUrl) || siteUrl(),
        referrer: fieldString(session.metadata?.referrer),
        userAgent: fieldString(session.metadata?.userAgent),
        ipAddress: fieldString(session.metadata?.ipAddress),
        ttp: fieldString(session.metadata?.ttp),
        ttclid: joinTikTokClickIdFromMetadata(
          fieldString(session.metadata?.ttclid),
          fieldString(session.metadata?.ttclidContinuation),
        ),
        packageId: packageId || "photo_test",
        contentName: isPhotoTestPackageId(packageId)
          ? photoTestPackages[packageId].title
          : "Picmaxx Paid Photo Test",
        amountCents: PHOTO_TEST_PRICE_CENTS,
        currency: PHOTO_TEST_CURRENCY,
      });
    } catch (error) {
      console.error(error);
    }
  });

  return Response.json({ ok: true });
}
