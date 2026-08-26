import {
  PHOTO_TEST_CURRENCY,
  PHOTO_TEST_PRICE_CENTS,
  isPhotoTestPackageId,
  photoTestPackages,
} from "@/lib/photo-test";
import { stripeClient } from "@/lib/server/stripe";

export const runtime = "nodejs";

type PurchaseStatusBody = {
  orderId?: unknown;
  sessionId?: unknown;
};

function identifier(value: unknown, maxLength: number) {
  return typeof value === "string" && value.length <= maxLength ? value : "";
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  let body: PurchaseStatusBody;

  try {
    body = (await request.json()) as PurchaseStatusBody;
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const orderId = identifier(body.orderId, 200);
  const sessionId = identifier(body.sessionId, 500);
  if (!orderId || !sessionId) {
    return json({ ok: false, error: "Missing purchase details" }, 400);
  }

  try {
    const session = await stripeClient().checkout.sessions.retrieve(sessionId);
    if (session.metadata?.orderId !== orderId) {
      return json({ ok: false, error: "Purchase not found" }, 404);
    }

    if (session.payment_status !== "paid") {
      return json({ ok: true, paid: false });
    }

    const packageId = session.metadata?.packageId ?? "";
    if (!isPhotoTestPackageId(packageId)) {
      return json({ ok: false, error: "Purchase package is invalid" }, 409);
    }

    return json({
      ok: true,
      paid: true,
      eventId: orderId,
      packageId,
      contentName: photoTestPackages[packageId].title,
      amountCents: session.amount_total ?? PHOTO_TEST_PRICE_CENTS,
      currency: session.currency ?? PHOTO_TEST_CURRENCY,
    });
  } catch {
    return json({ ok: false, error: "Purchase not found" }, 404);
  }
}
