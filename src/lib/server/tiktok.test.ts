import { describe, expect, it } from "bun:test";

import {
  createTikTokCommerceProperties,
  createTikTokViewContentProperties,
  isTikTokViewContentPath,
  joinTikTokClickIdFromMetadata,
  splitTikTokClickIdForMetadata,
} from "@/lib/tiktok";
import {
  buildTikTokEventsApiPayload,
  sendTikTokViewContentEvent,
} from "@/lib/server/tiktok";

describe("TikTok Events API payload", () => {
  it("uses the v1.3 web schema and hashes email identifiers", () => {
    const properties = createTikTokCommerceProperties({
      contentId: "single",
      contentName: "Lead photo score",
      value: 9,
      currency: "usd",
    });

    expect(
      buildTikTokEventsApiPayload(
        {
          eventName: "Purchase",
          eventId: "pmx_order_123",
          eventTime: 1_724_694_400,
          sourceUrl: "https://picmaxx.com/test/success",
          referrer: "https://checkout.stripe.com/",
          email: " USER@example.com ",
          ttp: "ttp-cookie",
          ttclid: "tt-click-id",
          ipAddress: "203.0.113.10",
          userAgent: "Test Browser",
          properties,
        },
        "TEST123",
      ),
    ).toEqual({
      event_source: "web",
      event_source_id: "DA7FS1RC77UC8FLJ6UT0",
      test_event_code: "TEST123",
      data: [
        {
          event: "Purchase",
          event_time: 1_724_694_400,
          event_id: "pmx_order_123",
          user: {
            email: [
              "b4c9a289323b21a01c3e940f150eb9b8c542587f1abfd8f0e1cc1ffc5e475514",
            ],
            external_id: [
              "b4c9a289323b21a01c3e940f150eb9b8c542587f1abfd8f0e1cc1ffc5e475514",
            ],
            ttp: "ttp-cookie",
            ttclid: "tt-click-id",
            ip: "203.0.113.10",
            user_agent: "Test Browser",
          },
          page: {
            url: "https://picmaxx.com/test/success",
            referrer: "https://checkout.stripe.com/",
          },
          properties,
        },
      ],
    });
  });

  it("omits unavailable optional match keys", () => {
    const payload = buildTikTokEventsApiPayload({
      eventName: "ViewContent",
      eventId: "view_123",
      eventTime: 1_724_694_400,
      sourceUrl: "https://picmaxx.com/",
      ipAddress: "",
      userAgent: "Test Browser",
      properties: createTikTokViewContentProperties({
        pathname: "/",
        value: 9,
        currency: "usd",
      }),
    });

    expect(payload.data[0].user).toEqual({ user_agent: "Test Browser" });
    expect(payload.data[0].page).toEqual({ url: "https://picmaxx.com/" });
    expect(payload).not.toHaveProperty("test_event_code");
  });

  it("maps the ad landing page to its specific product", () => {
    expect(
      createTikTokViewContentProperties({
        pathname: "/photo-test",
        value: 9,
        currency: "usd",
      }),
    ).toMatchObject({
      content_type: "product",
      currency: "USD",
      value: 9,
      contents: [
        {
          content_id: "single",
          content_name: "Picmaxx Lead Photo Score",
          price: 9,
          quantity: 1,
        },
      ],
    });
  });

  it("only treats offer pages as ViewContent pages", () => {
    expect(isTikTokViewContentPath("/")).toBe(true);
    expect(isTikTokViewContentPath("/test")).toBe(true);
    expect(isTikTokViewContentPath("/photo-test")).toBe(true);
    expect(isTikTokViewContentPath("/test/success")).toBe(false);
  });

  it("preserves a 1,000 character TikTok click ID", () => {
    const ttclid = "t".repeat(1000);
    const payload = buildTikTokEventsApiPayload({
      eventName: "InitiateCheckout",
      eventId: "checkout_123",
      eventTime: 1_724_694_400,
      sourceUrl: "https://picmaxx.com/test",
      ipAddress: "203.0.113.10",
      userAgent: "Test Browser",
      ttclid,
      properties: createTikTokViewContentProperties({
        pathname: "/test",
        value: 9,
        currency: "usd",
      }),
    });

    expect(payload.data[0].user).toMatchObject({ ttclid });
    const [firstPart, secondPart] = splitTikTokClickIdForMetadata(ttclid);
    expect(firstPart).toHaveLength(500);
    expect(secondPart).toHaveLength(500);
    expect(joinTikTokClickIdFromMetadata(firstPart, secondPart)).toBe(ttclid);
  });

  it("posts to v1.3 with the server-only access token header", async () => {
    const originalFetch = globalThis.fetch;
    const originalToken = process.env.TIKTOK_ACCESS_TOKEN;
    process.env.TIKTOK_ACCESS_TOKEN = "test-access-token";

    const testFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        "https://business-api.tiktok.com/open_api/v1.3/event/track/",
      );
      expect(new Headers(init?.headers).get("Access-Token")).toBe(
        "test-access-token",
      );
      const payload = JSON.parse(String(init?.body));
      expect(payload).toMatchObject({
        event_source: "web",
        event_source_id: "DA7FS1RC77UC8FLJ6UT0",
        data: [{ event: "ViewContent", event_id: "view_456" }],
      });
      return Response.json({ code: 0, message: "OK", request_id: "request_1" });
    };
    globalThis.fetch = Object.assign(testFetch, {
      preconnect: originalFetch.preconnect,
    });

    try {
      const result = await sendTikTokViewContentEvent({
        eventId: "view_456",
        eventTime: 1_724_694_400,
        sourceUrl: "https://picmaxx.com/test",
        ipAddress: "203.0.113.10",
        userAgent: "Test Browser",
        properties: createTikTokViewContentProperties({
          pathname: "/test",
          value: 9,
          currency: "usd",
        }),
      });
      expect(result.ok).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalToken === undefined) {
        delete process.env.TIKTOK_ACCESS_TOKEN;
      } else {
        process.env.TIKTOK_ACCESS_TOKEN = originalToken;
      }
    }
  });
});
