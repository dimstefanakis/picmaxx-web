import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

type AirtableFields = Record<string, string | number | boolean | null>;
type CheckoutSessionInput = Record<string, unknown>;
type CheckoutSessionOptions = Record<string, unknown>;
type PostHogMessage = {
  distinctId: string;
  event: string;
  uuid?: string;
  properties?: Record<string, unknown>;
};

const PURCHASE_EVENT_UUID = "73573012-86b5-5d28-a50d-6f2068523028";
const POSTHOG_DISTINCT_ID = "ph_contract_visitor";
const POSTHOG_SESSION_ID = "51d63a8e-c84b-4fa1-93ca-6f4910534c91";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const createdRecords: AirtableFields[] = [];
const updatedRecords: { recordId: string; fields: AirtableFields }[] = [];
const checkoutSessionInputs: CheckoutSessionInput[] = [];
const checkoutSessionOptions: CheckoutSessionOptions[] = [];
const capturedPostHogMessages: PostHogMessage[] = [];
const sideEffectOrder: string[] = [];
const deferredWork: (() => Promise<void> | void)[] = [];

const createPaidTestRecord = mock(async (fields: AirtableFields) => {
  createdRecords.push(fields);
  return { id: "rec_contract_test", fields };
});

const updatePaidTestRecord = mock(
  async (recordId: string, fields: AirtableFields) => {
    updatedRecords.push({ recordId, fields });
    sideEffectOrder.push(
      "Voter Age Range" in fields ? "airtable:age" : "airtable:status",
    );
    return { id: recordId, fields };
  },
);

const createUploadUrl = mock(
  async ({ key, contentType }: { key: string; contentType: string }) => ({
    key,
    uploadUrl: `https://uploads.example/${encodeURIComponent(key)}`,
    headers: { "Content-Type": contentType },
  }),
);

const r2ObjectExists = mock(async () => true);
const cachedPhotoPick = {
  version: "photo_picker_v1",
  winnerIndex: 1,
  confidence: "clear",
  reason: "Best framing.",
} as const;
const readR2Json = mock(async (): Promise<unknown> => cachedPhotoPick);
let postHogCaptureError: Error | undefined;
const capturePostHogServerEvent = mock(async (message: PostHogMessage) => {
  capturedPostHogMessages.push(message);
  if (postHogCaptureError) throw postHogCaptureError;
});
const postHogEventUuid = mock((namespace: string, id: string) => {
  if (namespace === "photo-test-purchase" && id === "pmx_contract_test") {
    return PURCHASE_EVENT_UUID;
  }
  return "3a40d88c-bff8-5fe5-9159-b6dd5b8a1cd2";
});
const sendMetaInitiateCheckoutEvent = mock(async () => ({ ok: true }));
const sendMetaPurchaseEvent = mock(async () => ({
  ok: true,
  status: 200,
  summary: "ok",
}));
const sendTikTokInitiateCheckoutEvent = mock(async () => ({ ok: true }));
const sendTikTokPurchaseEvent = mock(async () => ({ ok: true }));
const createCheckoutSession = mock(
  async (input: CheckoutSessionInput, options: CheckoutSessionOptions) => {
    checkoutSessionInputs.push(input);
    checkoutSessionOptions.push(options);
    sideEffectOrder.push("stripe");
    return {
      id: "cs_contract_test",
      url: "https://checkout.stripe.test/session",
      payment_status: "unpaid",
    };
  },
);

let retrievedCheckoutSession: Record<string, unknown>;
const retrieveCheckoutSession = mock(async () => retrievedCheckoutSession);
let constructedWebhookEvent: Record<string, unknown>;
const constructWebhookEvent = mock(() => constructedWebhookEvent);

mock.module("@/lib/server/airtable", () => ({
  createPaidTestRecord,
  updatePaidTestRecord,
}));

mock.module("@/lib/server/r2", () => ({
  createUploadUrl,
  r2ObjectExists,
  readR2Json,
}));

mock.module("@/lib/posthog-server", () => ({
  capturePostHogServerEvent,
  postHogEventUuid,
}));

mock.module("@/lib/server/meta", () => ({
  sendMetaInitiateCheckoutEvent,
  sendMetaPurchaseEvent,
}));

mock.module("@/lib/server/tiktok", () => ({
  sendTikTokInitiateCheckoutEvent,
  sendTikTokPurchaseEvent,
}));

mock.module("@/lib/server/stripe", () => ({
  stripeClient: () => ({
    checkout: {
      sessions: {
        create: createCheckoutSession,
        retrieve: retrieveCheckoutSession,
      },
    },
    webhooks: { constructEvent: constructWebhookEvent },
  }),
}));

mock.module("next/server", () => ({
  after: (callback: () => Promise<void> | void) => {
    deferredWork.push(callback);
  },
}));

mock.module("server-only", () => ({}));

const originalStripeSecret = process.env.STRIPE_SECRET_KEY;
const originalStripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
process.env.STRIPE_SECRET_KEY = "sk_test_photo_contract";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_photo_contract";
process.env.NEXT_PUBLIC_SITE_URL = "https://picmaxx.test";

const [
  { POST: initPhotoTest },
  { POST: checkoutPhotoTest },
  { POST: purchaseStatus },
  { POST: stripeWebhook },
  orderTokens,
] = await Promise.all([
  import("@/app/api/photo-tests/init/route"),
  import("@/app/api/photo-tests/checkout/route"),
  import("@/app/api/photo-tests/purchase-status/route"),
  import("@/app/api/stripe/webhook/route"),
  import("@/lib/server/photo-test-order-token"),
]);

const validFiles = Array.from({ length: 3 }, (_, index) => ({
  name: `photo-${index + 1}.jpg`,
  type: "image/jpeg",
  size: 1_024,
}));

function request(path: string, body: Record<string, unknown>) {
  return new Request(`https://picmaxx.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function settleDeferredWork() {
  const callbacks = deferredWork.splice(0);
  return Promise.allSettled(
    callbacks.map((callback) => Promise.resolve().then(callback)),
  );
}

function orderToken({
  email = "",
  packageId = "best_of_three",
  voterAgeRange,
  returnPath,
  posthogDistinctId,
  posthogSessionId,
}: {
  email?: string;
  packageId?: "single" | "best_of_three";
  voterAgeRange?: "18-24" | "25-34" | "35-44" | "45+";
  returnPath?: "/photo-test";
  posthogDistinctId?: string;
  posthogSessionId?: string;
} = {}) {
  return orderTokens.createPhotoTestOrderToken({
    orderId: "pmx_contract_test",
    airtableRecordId: "rec_contract_test",
    packageId,
    email,
    voterAgeRange,
    r2Keys: ["photo-1", "photo-2", "photo-3"],
    sourceUrl: "https://picmaxx.test/photo-test",
    referrer: "",
    fbp: "",
    fbc: "",
    posthogDistinctId,
    posthogSessionId,
    userAgent: "Contract Test",
    ipAddress: "203.0.113.10",
    returnPath,
    expiresAt: Date.now() + 60_000,
  });
}

beforeEach(() => {
  createdRecords.length = 0;
  updatedRecords.length = 0;
  checkoutSessionInputs.length = 0;
  checkoutSessionOptions.length = 0;
  capturedPostHogMessages.length = 0;
  sideEffectOrder.length = 0;
  deferredWork.length = 0;
  postHogCaptureError = undefined;
  retrievedCheckoutSession = {
    id: "cs_contract_test",
    payment_status: "paid",
    amount_total: 1_234,
    currency: "eur",
    metadata: {
      orderId: "pmx_contract_test",
      packageId: "single",
      purchaseEventUuid: PURCHASE_EVENT_UUID,
      offerVariant: "women_scorecard_v1",
    },
  };
  constructedWebhookEvent = {
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_contract_test",
        payment_status: "paid",
        amount_total: 1_234,
        currency: "eur",
        customer_details: { email: "buyer@example.com" },
        metadata: {
          orderId: "pmx_contract_test",
          airtableRecordId: "rec_contract_test",
          packageId: "single",
          purchaseEventUuid: PURCHASE_EVENT_UUID,
          posthogDistinctId: POSTHOG_DISTINCT_ID,
          posthogSessionId: POSTHOG_SESSION_ID,
          sourceUrl: "https://picmaxx.test/photo-test",
          voterAgeRange: "25-34",
          selectedPhotoPosition: "2",
          offerVariant: "women_scorecard_v1",
        },
      },
    },
  };
  createPaidTestRecord.mockClear();
  updatePaidTestRecord.mockClear();
  createUploadUrl.mockClear();
  r2ObjectExists.mockClear();
  readR2Json.mockClear();
  readR2Json.mockImplementation(async () => cachedPhotoPick);
  capturePostHogServerEvent.mockClear();
  postHogEventUuid.mockClear();
  sendMetaInitiateCheckoutEvent.mockClear();
  sendMetaPurchaseEvent.mockClear();
  sendTikTokInitiateCheckoutEvent.mockClear();
  sendTikTokPurchaseEvent.mockClear();
  createCheckoutSession.mockClear();
  retrieveCheckoutSession.mockClear();
  constructWebhookEvent.mockClear();
});

afterAll(() => {
  if (originalStripeSecret === undefined) {
    delete process.env.STRIPE_SECRET_KEY;
  } else {
    process.env.STRIPE_SECRET_KEY = originalStripeSecret;
  }

  if (originalStripeWebhookSecret === undefined) {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  } else {
    process.env.STRIPE_WEBHOOK_SECRET = originalStripeWebhookSecret;
  }

  if (originalSiteUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  } else {
    process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  }
});

describe("photo-test init contract", () => {
  it("creates an ad-flow upload without email or voter age", async () => {
    const response = await initPhotoTest(
      request("/api/photo-tests/init", {
        packageId: "best_of_three",
        files: validFiles,
        returnPath: "/photo-test",
        sourceUrl: "https://picmaxx.test/photo-test",
        posthogDistinctId: POSTHOG_DISTINCT_ID,
        posthogSessionId: POSTHOG_SESSION_ID,
      }),
    );
    const payload = (await response.json()) as {
      ok: true;
      orderId: string;
      orderToken: string;
      expiresAt: number;
      uploads: unknown[];
    };

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.uploads).toHaveLength(3);
    expect(createdRecords[0]).not.toHaveProperty("Email");
    expect(createdRecords[0]).not.toHaveProperty("Voter Age Range");

    const signedOrder = orderTokens.verifyPhotoTestOrderToken(
      payload.orderToken,
    );
    expect(signedOrder.email).toBe("");
    expect(signedOrder.voterAgeRange).toBeUndefined();
    expect(signedOrder.posthogDistinctId).toBe(POSTHOG_DISTINCT_ID);
    expect(signedOrder.posthogSessionId).toBe(POSTHOG_SESSION_ID);
    expect(payload.expiresAt).toBe(signedOrder.expiresAt);

    expect(capturePostHogServerEvent).not.toHaveBeenCalled();
    expect(deferredWork).toHaveLength(1);
    await settleDeferredWork();
    expect(capturePostHogServerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: POSTHOG_DISTINCT_ID,
        event: "photo_test_order_created",
        properties: expect.objectContaining({
          $session_id: POSTHOG_SESSION_ID,
          order_id: payload.orderId,
          package_id: "best_of_three",
          photo_count: 3,
          variant: "ad",
          offer_variant: "women_scorecard_v1",
        }),
      }),
    );
  });

  it("requires exactly three photos for best-of-three", async () => {
    const response = await initPhotoTest(
      request("/api/photo-tests/init", {
        packageId: "best_of_three",
        files: validFiles.slice(0, 2),
        returnPath: "/photo-test",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Find my best photo requires 3 photos.",
    });
  });

  it("keeps email and voter age required for the generic flow", async () => {
    const missingEmail = await initPhotoTest(
      request("/api/photo-tests/init", {
        packageId: "best_of_three",
        files: validFiles,
        voterAgeRange: "25-34",
      }),
    );
    expect(missingEmail.status).toBe(400);
    expect(await missingEmail.json()).toMatchObject({
      error: "Enter a valid email.",
    });

    const missingVoterAge = await initPhotoTest(
      request("/api/photo-tests/init", {
        packageId: "best_of_three",
        files: validFiles,
        email: "buyer@example.com",
      }),
    );
    expect(missingVoterAge.status).toBe(400);
    expect(await missingVoterAge.json()).toMatchObject({
      error: "Choose a valid voter age range.",
    });
  });

  it("keeps the generic best-of-three flow compatible with two photos", async () => {
    const response = await initPhotoTest(
      request("/api/photo-tests/init", {
        packageId: "best_of_three",
        files: validFiles.slice(0, 2),
        email: "buyer@example.com",
        voterAgeRange: "25-34",
      }),
    );

    expect(response.status).toBe(200);
    expect(createUploadUrl).toHaveBeenCalledTimes(2);
  });
});

describe("photo-test checkout contract", () => {
  it("requires ad voter age, persists it first, and lets Stripe collect email", async () => {
    const response = await checkoutPhotoTest(
      request("/api/photo-tests/checkout", {
        orderToken: orderToken({
          returnPath: "/photo-test",
          posthogDistinctId: POSTHOG_DISTINCT_ID,
          posthogSessionId: POSTHOG_SESSION_ID,
        }),
        voterAgeRange: "25-34",
      }),
    );

    expect(response.status).toBe(200);
    expect(updatedRecords[0]).toEqual({
      recordId: "rec_contract_test",
      fields: {
        Package: "Score one photo",
        "Package ID": "single",
        "Voter Age Range": "25-34",
        "R2 Keys": "photo-2",
      },
    });
    expect(sideEffectOrder).toEqual([
      "airtable:age",
      "stripe",
      "airtable:status",
    ]);

    const stripeInput = checkoutSessionInputs[0];
    expect(stripeInput).not.toHaveProperty("customer_email");
    expect(stripeInput.client_reference_id).toBe("pmx_contract_test");
    expect(stripeInput.metadata).toMatchObject({
      orderId: "pmx_contract_test",
      voterAgeRange: "25-34",
      email: "",
      purchaseEventUuid: PURCHASE_EVENT_UUID,
      posthogDistinctId: POSTHOG_DISTINCT_ID,
      posthogSessionId: POSTHOG_SESSION_ID,
      selectedPhotoPosition: "2",
      selectedR2Key: "photo-2",
      offerVariant: "women_scorecard_v1",
    });
    expect(
      (stripeInput.metadata as Record<string, unknown>).purchaseEventUuid,
    ).toMatch(UUID_PATTERN);
    expect(checkoutSessionOptions[0]).toEqual({
      idempotencyKey: "photo-test-checkout-v2:pmx_contract_test:25-34",
    });
    expect(stripeInput.cancel_url).toBe(
      "https://picmaxx.test/photo-test?checkout=cancelled&order=pmx_contract_test",
    );
    expect(readR2Json).toHaveBeenCalledWith(
      "photo-tests/pmx_contract_test/picker-v1.json",
    );
    expect(stripeInput.line_items).toEqual([
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: 900,
          product_data: {
            name: "Picmaxx Real-World Swipe Scorecard",
            description:
              "Swipe, date, hookup, and first-impression scores from 20 real women in your dating range.",
          },
        },
      },
    ]);
    expect(stripeInput.payment_intent_data).toEqual({
      metadata: stripeInput.metadata,
    });

    expect(capturePostHogServerEvent).not.toHaveBeenCalled();
    await settleDeferredWork();
    expect(capturePostHogServerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: POSTHOG_DISTINCT_ID,
        event: "photo_test_checkout_started",
        properties: expect.objectContaining({
          $session_id: POSTHOG_SESSION_ID,
          order_id: "pmx_contract_test",
          amount_cents: 900,
          value: 9,
          currency: "USD",
          variant: "ad",
          offer_variant: "women_scorecard_v1",
        }),
      }),
    );
  });

  it("scopes checkout idempotency to the selected voter age", async () => {
    const signedOrder = orderToken({ returnPath: "/photo-test" });

    await checkoutPhotoTest(
      request("/api/photo-tests/checkout", {
        orderToken: signedOrder,
        voterAgeRange: "25-34",
      }),
    );
    await checkoutPhotoTest(
      request("/api/photo-tests/checkout", {
        orderToken: signedOrder,
        voterAgeRange: "35-44",
      }),
    );

    expect(checkoutSessionOptions).toEqual([
      { idempotencyKey: "photo-test-checkout-v2:pmx_contract_test:25-34" },
      { idempotencyKey: "photo-test-checkout-v2:pmx_contract_test:35-44" },
    ]);
  });

  it("rejects an ad checkout when the winning photo was not saved", async () => {
    readR2Json.mockImplementationOnce(async () => null);

    const response = await checkoutPhotoTest(
      request("/api/photo-tests/checkout", {
        orderToken: orderToken({ returnPath: "/photo-test" }),
        voterAgeRange: "25-34",
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "Find your best photo first.",
    });
    expect(updatedRecords).toHaveLength(0);
    expect(checkoutSessionInputs).toHaveLength(0);
  });

  it("keeps picker cache failures away from Stripe and Airtable", async () => {
    readR2Json.mockImplementationOnce(async () => {
      throw new Error("R2 unavailable");
    });

    const response = await checkoutPhotoTest(
      request("/api/photo-tests/checkout", {
        orderToken: orderToken({ returnPath: "/photo-test" }),
        voterAgeRange: "25-34",
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "Could not load your selected photo. Try again.",
    });
    expect(updatedRecords).toHaveLength(0);
    expect(checkoutSessionInputs).toHaveLength(0);
  });

  it("rejects other packages from the ad flow", async () => {
    const response = await checkoutPhotoTest(
      request("/api/photo-tests/checkout", {
        orderToken: orderToken({
          packageId: "single",
          returnPath: "/photo-test",
        }),
        voterAgeRange: "25-34",
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "Order package is invalid for this flow.",
    });
    expect(readR2Json).not.toHaveBeenCalled();
    expect(updatedRecords).toHaveLength(0);
    expect(checkoutSessionInputs).toHaveLength(0);
  });

  it("rejects an ad checkout without voter age before external work", async () => {
    const response = await checkoutPhotoTest(
      request("/api/photo-tests/checkout", {
        orderToken: orderToken({ returnPath: "/photo-test" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Choose a valid voter age range.",
    });
    expect(updatedRecords).toHaveLength(0);
    expect(checkoutSessionInputs).toHaveLength(0);
  });

  it("uses the signed email and voter age for the generic flow", async () => {
    const response = await checkoutPhotoTest(
      request("/api/photo-tests/checkout", {
        orderToken: orderToken({
          email: "buyer@example.com",
          voterAgeRange: "35-44",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(updatedRecords).toHaveLength(1);
    expect(updatedRecords[0]?.fields).not.toHaveProperty("Voter Age Range");
    expect(checkoutSessionInputs[0]).toMatchObject({
      customer_email: "buyer@example.com",
      metadata: { voterAgeRange: "35-44" },
      line_items: [
        {
          price_data: {
            product_data: {
              name: "Picmaxx Best Photo Test",
              description: "Winner, ranking, and light signal on each photo.",
            },
          },
        },
      ],
    });
    expect(updatedRecords[0]?.fields).not.toHaveProperty("R2 Keys");
    expect(readR2Json).not.toHaveBeenCalled();
  });

  it("does not block checkout when deferred PostHog capture fails", async () => {
    postHogCaptureError = new Error("PostHog unavailable");

    const response = await checkoutPhotoTest(
      request("/api/photo-tests/checkout", {
        orderToken: orderToken({ returnPath: "/photo-test" }),
        voterAgeRange: "25-34",
      }),
    );

    expect(response.status).toBe(200);
    expect(capturePostHogServerEvent).not.toHaveBeenCalled();

    const deferredResults = await settleDeferredWork();
    expect(deferredResults.some((result) => result.status === "rejected")).toBe(
      true,
    );
  });
});

describe("photo-test purchase analytics contract", () => {
  it("returns Stripe totals and the same valid purchase UUID stored at checkout", async () => {
    const response = await purchaseStatus(
      request("/api/photo-tests/purchase-status", {
        orderId: "pmx_contract_test",
        sessionId: "cs_contract_test",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      paid: true,
      eventId: "pmx_contract_test",
      purchaseEventUuid: PURCHASE_EVENT_UUID,
      packageId: "single",
      offerVariant: "women_scorecard_v1",
      contentName: "Lead photo score",
      amountCents: 1_234,
      currency: "eur",
    });
    expect(PURCHASE_EVENT_UUID).toMatch(UUID_PATTERN);
  });

  it("uses one canonical purchase event with the paid Stripe total", async () => {
    const response = await stripeWebhook(
      new Request("https://picmaxx.test/api/stripe/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": "contract-signature",
        },
        body: JSON.stringify({ type: "checkout.session.completed" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(capturePostHogServerEvent).not.toHaveBeenCalled();
    expect(sendMetaPurchaseEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "pmx_contract_test",
        amountCents: 1_234,
        currency: "eur",
      }),
    );

    await settleDeferredWork();

    expect(capturePostHogServerEvent).toHaveBeenCalledTimes(1);
    expect(capturePostHogServerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: POSTHOG_DISTINCT_ID,
        event: "purchase_completed",
        uuid: PURCHASE_EVENT_UUID,
        properties: expect.objectContaining({
          $session_id: POSTHOG_SESSION_ID,
          order_id: "pmx_contract_test",
          stripe_session_id: "cs_contract_test",
          amount_cents: 1_234,
          value: 12.34,
          currency: "EUR",
          source: "stripe_webhook",
          offer_variant: "women_scorecard_v1",
        }),
      }),
    );
    expect(sendTikTokPurchaseEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "pmx_contract_test",
        amountCents: 1_234,
        currency: "eur",
      }),
    );
  });
});
