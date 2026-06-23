import {
  PHOTO_TEST_CURRENCY,
  PHOTO_TEST_PRICE_CENTS,
  isValidPhotoCount,
  isPhotoTestPackageId,
  photoTestPackages,
} from "@/lib/photo-test";
import { updatePaidTestRecord } from "@/lib/server/airtable";
import { siteUrl } from "@/lib/server/env";
import { sendMetaInitiateCheckoutEvent } from "@/lib/server/meta";
import { verifyPhotoTestOrderToken } from "@/lib/server/photo-test-order-token";
import { r2ObjectExists } from "@/lib/server/r2";
import { stripeClient } from "@/lib/server/stripe";

export const runtime = "nodejs";

type CheckoutBody = {
  orderToken?: unknown;
};

function jsonError(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

function metadataString(value: string) {
  return value.slice(0, 500);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CheckoutBody;
    const order = verifyPhotoTestOrderToken(body.orderToken);

    if (!isPhotoTestPackageId(order.packageId)) {
      return jsonError("Order package is invalid.", 409);
    }

    if (!isValidPhotoCount(order.packageId, order.r2Keys.length)) {
      return jsonError("Order photos are incomplete.", 409);
    }

    const uploaded = await Promise.all(order.r2Keys.map((key) => r2ObjectExists(key)));
    if (uploaded.some((exists) => !exists)) {
      return jsonError("Photo upload is still finishing. Try again in a moment.", 409);
    }

    const origin = siteUrl();
    const config = photoTestPackages[order.packageId];
    const initiateCheckoutEventId = `${order.orderId}_initiate_checkout`;
    const cancelPath = order.returnPath ?? "/test";
    const session = await stripeClient().checkout.sessions.create({
      mode: "payment",
      customer_email: order.email,
      submit_type: "pay",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: PHOTO_TEST_CURRENCY,
            unit_amount: PHOTO_TEST_PRICE_CENTS,
            product_data: {
              name: config.stripeName,
              description: config.resultCopy,
            },
          },
        },
      ],
      metadata: {
        orderId: order.orderId,
        packageId: order.packageId,
        airtableRecordId: order.airtableRecordId,
        email: metadataString(order.email),
        sourceUrl: metadataString(order.sourceUrl),
        fbp: metadataString(order.fbp),
        fbc: metadataString(order.fbc),
        userAgent: metadataString(order.userAgent),
        ipAddress: metadataString(order.ipAddress),
        initiateCheckoutEventId,
      },
      success_url: `${origin}/test/success?order=${encodeURIComponent(order.orderId)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${cancelPath}?order=${encodeURIComponent(order.orderId)}`,
    });

    await updatePaidTestRecord(order.airtableRecordId, {
      Status: "checkout_started",
      "Stripe Session ID": session.id,
      "Payment Status": session.payment_status ?? "unpaid",
    });

    await sendMetaInitiateCheckoutEvent({
      email: order.email,
      eventId: initiateCheckoutEventId,
      sourceUrl: order.sourceUrl,
      userAgent: order.userAgent,
      ipAddress: order.ipAddress,
      fbp: order.fbp,
      fbc: order.fbc,
      packageId: order.packageId,
      amountCents: PHOTO_TEST_PRICE_CENTS,
      currency: PHOTO_TEST_CURRENCY,
    }).catch((error) => console.error(error));

    return Response.json({
      ok: true,
      checkoutUrl: session.url,
      initiateCheckoutEventId,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonError("Invalid JSON");
    }
    if (error instanceof Error && (error.message.startsWith("Order ") || error.message === "Order is missing.")) {
      return jsonError(error.message, 400);
    }
    if (error instanceof Error && error.message.startsWith("Missing ")) {
      return jsonError(`${error.message}. Add it to web/.env.local and restart next dev.`, 500);
    }
    console.error(error);
    return jsonError("Could not open checkout. Check server configuration.", 500);
  }
}
