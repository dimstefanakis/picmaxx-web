import { describe, expect, it } from "bun:test";

import {
  PHOTO_TEST_CHECKOUT_RESUME_KEY_PREFIX,
  clearPhotoTestCheckoutResume,
  parsePhotoTestCheckoutResume,
  readPhotoTestCheckoutResume,
  savePhotoTestCheckoutResume,
} from "./photo-test-checkout-resume";

function storage(initialValue: string | null = null, orderId = "pmx_resume_test") {
  const values = new Map<string, string>();
  if (initialValue !== null) {
    values.set(`${PHOTO_TEST_CHECKOUT_RESUME_KEY_PREFIX}${orderId}`, initialValue);
  }

  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, nextValue: string) {
      values.set(key, nextValue);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

describe("photo-test checkout resume", () => {
  it("round-trips a valid checkout state", () => {
    const session = storage();
    savePhotoTestCheckoutResume(session, {
      orderId: "pmx_resume_test",
      orderToken: "signed-order-token",
      voterAgeRange: "25-34",
      expiresAt: Date.now() + 60_000,
    });

    expect(readPhotoTestCheckoutResume(session, "pmx_resume_test")).toMatchObject({
      version: 1,
      orderId: "pmx_resume_test",
      orderToken: "signed-order-token",
      voterAgeRange: "25-34",
    });
  });

  it("rejects expired, future, and malformed state", () => {
    const now = Date.UTC(2026, 7, 31, 12);
    const validBase = {
      version: 1,
      orderId: "pmx_resume_test",
      orderToken: "signed-order-token",
      voterAgeRange: "25-34",
    };

    expect(
      parsePhotoTestCheckoutResume(
        JSON.stringify({ ...validBase, expiresAt: now }),
        "pmx_resume_test",
        now,
      ),
    ).toBeNull();
    expect(
      parsePhotoTestCheckoutResume(
        JSON.stringify({ ...validBase, expiresAt: now + 60_000 }),
        "pmx_other_order",
        now,
      ),
    ).toBeNull();
    expect(
      parsePhotoTestCheckoutResume("not-json", "pmx_resume_test", now),
    ).toBeNull();
  });

  it("clears unusable and explicitly completed state", () => {
    const invalidSession = storage("not-json");
    expect(
      readPhotoTestCheckoutResume(invalidSession, "pmx_resume_test"),
    ).toBeNull();
    expect(
      invalidSession.getItem(
        `${PHOTO_TEST_CHECKOUT_RESUME_KEY_PREFIX}pmx_resume_test`,
      ),
    ).toBeNull();

    const completedSession = storage("saved");
    clearPhotoTestCheckoutResume(completedSession, "pmx_resume_test");
    expect(
      completedSession.getItem(
        `${PHOTO_TEST_CHECKOUT_RESUME_KEY_PREFIX}pmx_resume_test`,
      ),
    ).toBeNull();
  });

  it("does not throw when browser storage is unavailable", () => {
    const unavailableStorage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
    };

    expect(
      savePhotoTestCheckoutResume(unavailableStorage, {
        orderId: "pmx_resume_test",
        orderToken: "signed-order-token",
        voterAgeRange: "25-34",
        expiresAt: Date.now() + 60_000,
      }),
    ).toBe(false);
    expect(
      readPhotoTestCheckoutResume(unavailableStorage, "pmx_resume_test"),
    ).toBeNull();
    expect(() =>
      clearPhotoTestCheckoutResume(unavailableStorage, "pmx_resume_test"),
    ).not.toThrow();
  });
});
