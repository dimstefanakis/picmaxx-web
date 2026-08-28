import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

type AirtableFields = Record<string, string | number | boolean | null>;
type CheckoutSessionInput = Record<string, unknown>;

const createdRecords: AirtableFields[] = [];
const updatedRecords: { recordId: string; fields: AirtableFields }[] = [];
const checkoutSessionInputs: CheckoutSessionInput[] = [];
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
const capture = mock(() => undefined);
const sendMetaInitiateCheckoutEvent = mock(async () => ({ ok: true }));
const sendTikTokInitiateCheckoutEvent = mock(async () => ({ ok: true }));
const createCheckoutSession = mock(async (input: CheckoutSessionInput) => {
  checkoutSessionInputs.push(input);
  sideEffectOrder.push("stripe");
  return {
    id: "cs_contract_test",
    url: "https://checkout.stripe.test/session",
    payment_status: "unpaid",
  };
});

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
  getPostHogClient: () => ({ capture }),
}));

mock.module("@/lib/server/meta", () => ({
  sendMetaInitiateCheckoutEvent,
}));

mock.module("@/lib/server/tiktok", () => ({
  sendTikTokInitiateCheckoutEvent,
}));

mock.module("@/lib/server/stripe", () => ({
  stripeClient: () => ({
    checkout: { sessions: { create: createCheckoutSession } },
  }),
}));

mock.module("next/server", () => ({
  after: (callback: () => Promise<void> | void) => {
    deferredWork.push(callback);
  },
}));

mock.module("server-only", () => ({}));

const originalStripeSecret = process.env.STRIPE_SECRET_KEY;
const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
process.env.STRIPE_SECRET_KEY = "sk_test_photo_contract";
process.env.NEXT_PUBLIC_SITE_URL = "https://picmaxx.test";

const [{ POST: initPhotoTest }, { POST: checkoutPhotoTest }, orderTokens] =
  await Promise.all([
    import("@/app/api/photo-tests/init/route"),
    import("@/app/api/photo-tests/checkout/route"),
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

function orderToken({
  email = "",
  packageId = "best_of_three",
  voterAgeRange,
  returnPath,
}: {
  email?: string;
  packageId?: "single" | "best_of_three";
  voterAgeRange?: "18-24" | "25-34" | "35-44" | "45+";
  returnPath?: "/photo-test";
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
  sideEffectOrder.length = 0;
  deferredWork.length = 0;
  createPaidTestRecord.mockClear();
  updatePaidTestRecord.mockClear();
  createUploadUrl.mockClear();
  r2ObjectExists.mockClear();
  readR2Json.mockClear();
  readR2Json.mockImplementation(async () => cachedPhotoPick);
  capture.mockClear();
  sendMetaInitiateCheckoutEvent.mockClear();
  sendTikTokInitiateCheckoutEvent.mockClear();
  createCheckoutSession.mockClear();
});

afterAll(() => {
  if (originalStripeSecret === undefined) {
    delete process.env.STRIPE_SECRET_KEY;
  } else {
    process.env.STRIPE_SECRET_KEY = originalStripeSecret;
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
      }),
    );
    const payload = (await response.json()) as {
      ok: true;
      orderToken: string;
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
        orderToken: orderToken({ returnPath: "/photo-test" }),
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
      selectedPhotoPosition: "2",
      selectedR2Key: "photo-2",
    });
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
            name: "Picmaxx 20-Woman Photo Score",
            description:
              "20 real women score your selected photo out of 10 and explain what helped or hurt.",
          },
        },
      },
    ]);
    expect(stripeInput.payment_intent_data).toEqual({
      metadata: stripeInput.metadata,
    });
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
});
