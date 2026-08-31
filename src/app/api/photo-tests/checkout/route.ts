import { after } from "next/server";

import {
  PHOTO_TEST_CURRENCY,
  PHOTO_TEST_PRICE_CENTS,
  isValidPhotoCount,
  isPhotoTestPackageId,
  isVoterAgeRange,
  photoTestAdCheckout,
  photoTestPackages,
} from "@/lib/photo-test";
import { updatePaidTestRecord } from "@/lib/server/airtable";
import { siteUrl } from "@/lib/server/env";
import { sendMetaInitiateCheckoutEvent } from "@/lib/server/meta";
import {
  capturePostHogServerEvent,
  postHogEventUuid,
} from "@/lib/posthog-server";
import {
  normalizePhotoPickForClient,
  photoPickerCacheKey,
} from "@/lib/server/photo-picker";
import { verifyPhotoTestOrderToken } from "@/lib/server/photo-test-order-token";
import { r2ObjectExists, readR2Json } from "@/lib/server/r2";
import { stripeClient } from "@/lib/server/stripe";
import { sendTikTokInitiateCheckoutEvent } from "@/lib/server/tiktok";
import { splitTikTokClickIdForMetadata } from "@/lib/tiktok";

export const runtime = "nodejs";
export const maxDuration = 35;

type CheckoutBody = {
  orderToken?: unknown;
  voterAgeRange?: unknown;
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
    const isAdFlow = order.returnPath === "/photo-test";
    const submittedVoterAgeRange = isVoterAgeRange(body.voterAgeRange)
      ? body.voterAgeRange
      : undefined;

    if (body.voterAgeRange !== undefined && !submittedVoterAgeRange) {
      return jsonError("Choose a valid voter age range.");
    }
    if (isAdFlow && !submittedVoterAgeRange) {
      return jsonError("Choose a valid voter age range.");
    }

    const voterAgeRange = isAdFlow
      ? submittedVoterAgeRange
      : isVoterAgeRange(order.voterAgeRange)
        ? order.voterAgeRange
        : undefined;

    if (!isPhotoTestPackageId(order.packageId)) {
      return jsonError("Order package is invalid.", 409);
    }
    if (isAdFlow && order.packageId !== "best_of_three") {
      return jsonError("Order package is invalid for this flow.", 409);
    }

    if (!isValidPhotoCount(order.packageId, order.r2Keys.length)) {
      return jsonError("Order photos are incomplete.", 409);
    }

    const uploaded = await Promise.all(order.r2Keys.map((key) => r2ObjectExists(key)));
    if (uploaded.some((exists) => !exists)) {
      return jsonError("Photo upload is still finishing. Try again in a moment.", 409);
    }

    let selectedR2Key = "";
    let selectedPhotoPosition = "";
    if (isAdFlow) {
      try {
        const cachedPick = normalizePhotoPickForClient(
          await readR2Json<unknown>(photoPickerCacheKey(order.orderId)),
        );
        if (!cachedPick) {
          return jsonError("Find your best photo first.", 409);
        }

        selectedR2Key = order.r2Keys[cachedPick.winnerIndex] ?? "";
        selectedPhotoPosition = String(cachedPick.winnerIndex + 1);
        if (!selectedR2Key) {
          return jsonError("Selected photo is unavailable. Try again.", 409);
        }
      } catch (error) {
        console.error(error);
        return jsonError("Could not load your selected photo. Try again.", 503);
      }
    }

    const origin = siteUrl();
    const config = photoTestPackages[order.packageId];
    const stripeName = isAdFlow
      ? photoTestAdCheckout.stripeName
      : config.stripeName;
    const resultCopy = isAdFlow
      ? photoTestAdCheckout.resultCopy
      : config.resultCopy;
    const initiateCheckoutEventId = `${order.orderId}_initiate_checkout`;
    const cancelPath = order.returnPath ?? "/test";
    const [ttclid, ttclidContinuation] = splitTikTokClickIdForMetadata(
      order.ttclid ?? "",
    );
    const metadata = {
      orderId: order.orderId,
      packageId: order.packageId,
      airtableRecordId: order.airtableRecordId,
      email: metadataString(order.email),
      voterAgeRange: metadataString(voterAgeRange ?? ""),
      sourceUrl: metadataString(order.sourceUrl),
      referrer: metadataString(order.referrer),
      fbp: metadataString(order.fbp),
      fbc: metadataString(order.fbc),
      ttp: metadataString(order.ttp ?? ""),
      ttclid,
      ttclidContinuation,
      userAgent: metadataString(order.userAgent),
      ipAddress: metadataString(order.ipAddress),
      initiateCheckoutEventId,
      selectedPhotoPosition,
      selectedR2Key: metadataString(selectedR2Key),
      ...(isAdFlow
        ? { offerVariant: photoTestAdCheckout.offerVariant }
        : {}),
      posthogDistinctId: metadataString(
        order.posthogDistinctId || order.email || order.orderId,
      ),
      posthogSessionId: metadataString(order.posthogSessionId ?? ""),
      purchaseEventUuid: postHogEventUuid(
        "photo-test-purchase",
        order.orderId,
      ),
    };

    if (isAdFlow && voterAgeRange && selectedR2Key) {
      await updatePaidTestRecord(order.airtableRecordId, {
        Package: photoTestPackages.single.airtableLabel,
        "Package ID": photoTestPackages.single.id,
        "Voter Age Range": voterAgeRange,
        "R2 Keys": selectedR2Key,
      });
    }

    const session = await stripeClient().checkout.sessions.create(
      {
        mode: "payment",
        ...(order.email ? { customer_email: order.email } : {}),
        client_reference_id: order.orderId,
        submit_type: "pay",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: PHOTO_TEST_CURRENCY,
              unit_amount: PHOTO_TEST_PRICE_CENTS,
              product_data: {
                name: stripeName,
                description: resultCopy,
              },
            },
          },
        ],
        metadata,
        payment_intent_data: {
          metadata,
        },
        success_url: `${origin}/test/success?order=${encodeURIComponent(order.orderId)}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: isAdFlow
          ? `${origin}${cancelPath}?checkout=cancelled&order=${encodeURIComponent(order.orderId)}`
          : `${origin}${cancelPath}?order=${encodeURIComponent(order.orderId)}`,
      },
      {
        idempotencyKey: `photo-test-checkout-v2:${order.orderId}:${voterAgeRange ?? "default"}`,
      },
    );

    await updatePaidTestRecord(order.airtableRecordId, {
      Status: "checkout_started",
      "Stripe Session ID": session.id,
      "Payment Status": session.payment_status ?? "unpaid",
    });

    after(async () => {
      try {
        await sendTikTokInitiateCheckoutEvent({
          email: order.email,
          eventId: initiateCheckoutEventId,
          sourceUrl: order.sourceUrl,
          referrer: order.referrer,
          userAgent: order.userAgent,
          ipAddress: order.ipAddress,
          ttp: order.ttp ?? "",
          ttclid: order.ttclid ?? "",
          packageId: order.packageId,
          contentName: config.title,
          amountCents: PHOTO_TEST_PRICE_CENTS,
          currency: PHOTO_TEST_CURRENCY,
        });
      } catch (error) {
        console.error(error);
      }
    });

    after(async () => {
      try {
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
        });
      } catch (error) {
        console.error(error);
      }
    });

    after(() => {
      return capturePostHogServerEvent({
        distinctId:
          order.posthogDistinctId || order.email || order.orderId,
        event: "photo_test_checkout_started",
        uuid: postHogEventUuid(
          "photo-test-checkout-started",
          order.orderId,
        ),
        properties: {
          $insert_id: `photo-test-checkout-${session.id}`,
          order_id: order.orderId,
          package_id: order.packageId,
          stripe_session_id: session.id,
          amount_cents: PHOTO_TEST_PRICE_CENTS,
          value: PHOTO_TEST_PRICE_CENTS / 100,
          currency: PHOTO_TEST_CURRENCY.toUpperCase(),
          voter_age_range: voterAgeRange,
          selected_photo_position: selectedPhotoPosition || undefined,
          variant: isAdFlow ? "ad" : "generic",
          ...(isAdFlow
            ? { offer_variant: photoTestAdCheckout.offerVariant }
            : {}),
          ...(order.posthogSessionId
            ? { $session_id: order.posthogSessionId }
            : {}),
        },
      });
    });

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
