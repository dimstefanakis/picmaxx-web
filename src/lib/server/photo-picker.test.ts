import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const {
  PHOTO_PICKER_MAX_IMAGE_BYTES,
  PHOTO_PICKER_VERSION,
  buildPhotoPickerRequest,
  createPhotoPick,
  isJpegBytes,
  isValidPhotoPickerId,
  normalizePhotoPick,
  normalizePhotoPickForClient,
  parsePhotoPickerResponse,
  photoPickForClient,
  photoPickerCacheKey,
} = await import("./photo-picker");

const originalApiKey = process.env.OPENAI_API_KEY;
const originalModel = process.env.OPENAI_PHOTO_PICKER_MODEL;
const pickId = "123e4567-e89b-42d3-a456-426614174000";
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_PHOTO_PICKER_MODEL = "picker-test-model";
});

afterAll(() => {
  restoreEnv("OPENAI_API_KEY", originalApiKey);
  restoreEnv("OPENAI_PHOTO_PICKER_MODEL", originalModel);
});

describe("photo picker validation", () => {
  it("validates picker IDs and complete JPEG byte markers", () => {
    expect(isValidPhotoPickerId(pickId)).toBe(true);
    expect(isValidPhotoPickerId("not-a-uuid")).toBe(false);
    expect(isJpegBytes(jpeg)).toBe(true);
    expect(isJpegBytes(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false);
  });

  it("normalizes valid output and rejects unsupported provider shapes", () => {
    expect(
      normalizePhotoPick({
        bestPhoto: "photo_2",
        setQuality: "weak",
        headline: "  Photo 1 is the clear winner.  ",
        strength: "  Basic face visibility.  ",
        diagnosis:
          "  The angle is doing you zero favors, and the expression gives nothing.  ",
        bridge: "  Wrong bridge.  ",
      }),
    ).toEqual({
      bestPhoto: "photo_2",
      setQuality: "weak",
      headline: "Photo 2 wins this set. Barely.",
      strength: null,
      diagnosis:
        "The angle is doing you zero favors, and the expression gives nothing.",
      bridge:
        "Winning this set only makes it your best option. See how 20 real women in your dating range score it.",
    });

    expect(
      normalizePhotoPick({
        bestPhoto: "photo_4",
        setQuality: "weak",
        headline: "Nope",
        strength: null,
        diagnosis: "Nope",
        bridge: "Nope",
      }),
    ).toBeNull();
    expect(
      normalizePhotoPick({
        bestPhoto: "photo_1",
        setQuality: "weak",
        headline: "Photo 1 wins this set. Barely.",
        strength: null,
        diagnosis: "x".repeat(181),
        bridge:
          "Winning this set only makes it your best option. See how 20 real women in your dating range score it.",
      }),
    ).toBeNull();
    expect(
      normalizePhotoPick({
        bestPhoto: "photo_1",
        setQuality: "average",
        headline: "Nope",
        strength: null,
        diagnosis: "Nope",
        bridge: "Nope",
      }),
    ).toBeNull();
    expect(
      normalizePhotoPick({
        bestPhoto: "photo_1",
        setQuality: "usable",
        headline: "Photo 1 is the safest option.",
        strength: "   ",
        diagnosis: "The crop is too tight.",
        bridge: "See how 20 real women score it.",
      }),
    ).toBeNull();
  });

  it("maps stable photo IDs to a zero-based client index", () => {
    expect(
      photoPickForClient({
        bestPhoto: "photo_3",
        setQuality: "usable",
        headline: "Photo 3 is the safest option.",
        strength: "The expression feels natural.",
        diagnosis: "The background is doing too much.",
        bridge: "See how 20 real women score it.",
      }),
    ).toEqual({
      version: PHOTO_PICKER_VERSION,
      winnerIndex: 2,
      confidence: "close",
      reason: "The expression feels natural.",
      setQuality: "usable",
      headline: "Photo 3 is the safest option.",
      strength: "The expression feels natural.",
      diagnosis: "The background is doing too much.",
      bridge: "See how 20 real women score it.",
    });
  });

  it("normalizes the public cache representation", () => {
    expect(
      normalizePhotoPickForClient({
        version: PHOTO_PICKER_VERSION,
        winnerIndex: 1,
        confidence: "clear",
        reason: "  Better light\nand framing. ",
      }),
    ).toEqual({
      version: PHOTO_PICKER_VERSION,
      winnerIndex: 1,
      confidence: "clear",
      reason: "Better light and framing.",
    });
    expect(
      normalizePhotoPickForClient({
        version: PHOTO_PICKER_VERSION,
        winnerIndex: 3,
        confidence: "clear",
        reason: "Invalid index.",
      }),
    ).toBeNull();

    expect(
      normalizePhotoPickForClient({
        version: PHOTO_PICKER_VERSION,
        winnerIndex: 0,
        confidence: "close",
        reason: "The relaxed expression feels natural.",
        setQuality: "strong",
        headline: "  Photo 1 is the clear winner. ",
        strength: "  The relaxed\nexpression feels natural. ",
        diagnosis: "  The crop is slightly tight. ",
        bridge: "  See how 20 real women score it. ",
      }),
    ).toEqual({
      version: PHOTO_PICKER_VERSION,
      winnerIndex: 0,
      confidence: "close",
      reason: "The relaxed expression feels natural.",
      setQuality: "strong",
      headline: "Photo 1 is the clear winner.",
      strength: "The relaxed expression feels natural.",
      diagnosis: "The crop is slightly tight.",
      bridge: "See how 20 real women score it.",
    });

    expect(
      normalizePhotoPickForClient({
        version: PHOTO_PICKER_VERSION,
        winnerIndex: 1,
        confidence: "close",
        reason: "The angle is doing you zero favors.",
        setQuality: "weak",
        headline: "Photo 2 wins this set. Barely.",
        strength: null,
        diagnosis: "The angle is doing you zero favors.",
        bridge:
          "Winning this set only makes it your best option. See how 20 real women in your dating range score it.",
      }),
    ).toMatchObject({
      winnerIndex: 1,
      setQuality: "weak",
      strength: null,
      diagnosis: "The angle is doing you zero favors.",
    });

    expect(
      normalizePhotoPickForClient({
        version: PHOTO_PICKER_VERSION,
        winnerIndex: 0,
        confidence: "close",
        reason: "Legacy copy survives.",
        setQuality: "weak",
      }),
    ).toEqual({
      version: PHOTO_PICKER_VERSION,
      winnerIndex: 0,
      confidence: "close",
      reason: "Legacy copy survives.",
    });

    expect(
      normalizePhotoPickForClient({
        version: PHOTO_PICKER_VERSION,
        winnerIndex: 0,
        confidence: "close",
        reason: "Strong expression — messy background.",
      }),
    ).toMatchObject({
      reason: "Strong expression, messy background.",
    });
  });

  it("builds only versioned, order-scoped cache keys", () => {
    expect(photoPickerCacheKey("pmx_order_123")).toBe(
      "photo-tests/pmx_order_123/picker-v1.json",
    );
    expect(() => photoPickerCacheKey("../other-order")).toThrow(
      "Photo picker order is invalid.",
    );
  });
});

describe("photo picker Responses API contract", () => {
  it("sends three labeled, high-detail JPEG inputs with strict output", () => {
    const request = buildPhotoPickerRequest({
      imageBase64: ["one", "two", "three"],
      pickId,
      model: "picker-test-model",
    });
    const content = request.input[0].content;
    const images = content.filter(
      (item): item is Extract<typeof item, { type: "input_image" }> =>
        item.type === "input_image",
    );
    const labels = content.filter(
      (item): item is Extract<typeof item, { type: "input_text" }> =>
        item.type === "input_text" && /^photo_[123]:$/.test(item.text),
    );

    expect(request.model).toBe("picker-test-model");
    expect(request.reasoning).toEqual({ effort: "none" });
    expect(request.store).toBe(false);
    expect(request.max_output_tokens).toBe(320);
    expect(request.metadata).toEqual({ pick_id: pickId });
    expect(request.instructions).toContain(
      "Winning a bad set does not make a photo good.",
    );
    expect(request.instructions).toContain("Never invent praise.");
    expect(request.text.format).toMatchObject({
      type: "json_schema",
      name: PHOTO_PICKER_VERSION,
      strict: true,
    });
    expect(request.text.format.schema.required).toEqual([
      "bestPhoto",
      "setQuality",
      "headline",
      "strength",
      "diagnosis",
      "bridge",
    ]);
    expect(request.text.format.schema.properties.setQuality.enum).toEqual([
      "strong",
      "usable",
      "weak",
    ]);
    expect(request.text.format.schema.properties.strength.type).toEqual([
      "string",
      "null",
    ]);
    expect(request.text.format.schema.properties.strength.minLength).toBe(1);
    expect(request.text.format.schema.properties.diagnosis).toMatchObject({
      minLength: 1,
      maxLength: 180,
    });
    expect(labels.map((label) => label.text)).toEqual([
      "photo_1:",
      "photo_2:",
      "photo_3:",
    ]);
    expect(images).toHaveLength(3);
    expect(images.map((image) => image.detail)).toEqual([
      "high",
      "high",
      "high",
    ]);
    expect(images.map((image) => image.image_url)).toEqual([
      "data:image/jpeg;base64,one",
      "data:image/jpeg;base64,two",
      "data:image/jpeg;base64,three",
    ]);
  });

  it("parses both top-level and output-item response text", () => {
    const serialized = JSON.stringify({
      bestPhoto: "photo_1",
      setQuality: "usable",
      headline: "Photo 1 is the safest option.",
      strength: "The expression feels natural.",
      diagnosis: "The crop is slightly tight.",
      bridge: "See how 20 real women score it.",
    });

    expect(
      parsePhotoPickerResponse({ output_text: serialized })?.bestPhoto,
    ).toBe("photo_1");
    expect(
      parsePhotoPickerResponse({
        output: [
          {
            content: [{ type: "output_text", text: serialized }],
          },
        ],
      })?.bestPhoto,
    ).toBe("photo_1");
    expect(parsePhotoPickerResponse({ output_text: "not json" })).toBeNull();
  });

  it("uses the server key and returns normalized structured output", async () => {
    const fetchImplementation = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://api.openai.com/v1/responses");
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer test-key",
        );
        expect(new Headers(init?.headers).get("X-Client-Request-Id")).toBe(
          pickId,
        );

        const body = JSON.parse(String(init?.body)) as {
          model: string;
          store: boolean;
        };
        expect(body.model).toBe("picker-test-model");
        expect(body.store).toBe(false);

        return Response.json({
          output_text: JSON.stringify({
            bestPhoto: "photo_2",
            setQuality: "weak",
            headline: " Photo 2 wins this set. Barely. ",
            strength: null,
            diagnosis:
              " The angle is doing you zero favors, and the expression gives nothing. ",
            bridge:
              " Winning this set only makes it your best option. See how 20 real women in your dating range score it. ",
          }),
        });
      },
    );

    const pick = await createPhotoPick({
      imageBytes: [jpeg, jpeg, jpeg],
      pickId,
      fetchImplementation,
    });

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(pick).toEqual({
      bestPhoto: "photo_2",
      setQuality: "weak",
      headline: "Photo 2 wins this set. Barely.",
      strength: null,
      diagnosis:
        "The angle is doing you zero favors, and the expression gives nothing.",
      bridge:
        "Winning this set only makes it your best option. See how 20 real women in your dating range score it.",
    });
  });

  it("rejects invalid images before calling the provider", async () => {
    const fetchImplementation = mock(async () => Response.json({}));
    const oversized = new Uint8Array(PHOTO_PICKER_MAX_IMAGE_BYTES + 1);

    await expect(
      createPhotoPick({
        imageBytes: [jpeg, jpeg, oversized],
        pickId,
        fetchImplementation,
      }),
    ).rejects.toThrow("Photo picker is unavailable.");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("does not expose provider failures", async () => {
    await expect(
      createPhotoPick({
        imageBytes: [jpeg, jpeg, jpeg],
        pickId,
        fetchImplementation: async () =>
          new Response("provider-secret-details", { status: 500 }),
      }),
    ).rejects.toThrow("Photo picker is unavailable.");
  });
});
