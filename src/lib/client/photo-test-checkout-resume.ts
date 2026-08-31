import {
  type VoterAgeRange,
  isVoterAgeRange,
} from "@/lib/photo-test";

export const PHOTO_TEST_CHECKOUT_RESUME_KEY_PREFIX =
  "picmaxx_photo_test_checkout_resume_v1:";

export type PhotoTestCheckoutResumeState = {
  version: 1;
  orderId: string;
  orderToken: string;
  voterAgeRange: VoterAgeRange;
  expiresAt: number;
};

type SessionStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

function storageKey(orderId: string) {
  return `${PHOTO_TEST_CHECKOUT_RESUME_KEY_PREFIX}${orderId}`;
}

export function parsePhotoTestCheckoutResume(
  rawValue: string | null,
  expectedOrderId: string,
  now = Date.now(),
): PhotoTestCheckoutResumeState | null {
  if (!rawValue) return null;

  try {
    const candidate = JSON.parse(rawValue) as Partial<PhotoTestCheckoutResumeState>;
    if (
      candidate.version !== 1 ||
      typeof candidate.orderId !== "string" ||
      candidate.orderId !== expectedOrderId ||
      typeof candidate.orderToken !== "string" ||
      candidate.orderToken.trim().length === 0 ||
      !isVoterAgeRange(candidate.voterAgeRange) ||
      typeof candidate.expiresAt !== "number" ||
      !Number.isFinite(candidate.expiresAt) ||
      candidate.expiresAt <= now
    ) {
      return null;
    }

    return candidate as PhotoTestCheckoutResumeState;
  } catch {
    return null;
  }
}

export function readPhotoTestCheckoutResume(
  storage: SessionStorage,
  expectedOrderId: string,
  now = Date.now(),
) {
  try {
    const key = storageKey(expectedOrderId);
    const state = parsePhotoTestCheckoutResume(
      storage.getItem(key),
      expectedOrderId,
      now,
    );
    if (!state) storage.removeItem(key);
    return state;
  } catch {
    return null;
  }
}

export function savePhotoTestCheckoutResume(
  storage: SessionStorage,
  state: Omit<PhotoTestCheckoutResumeState, "version">,
) {
  try {
    storage.setItem(
      storageKey(state.orderId),
      JSON.stringify({
        ...state,
        version: 1,
      } satisfies PhotoTestCheckoutResumeState),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearPhotoTestCheckoutResume(
  storage: SessionStorage,
  orderId: string,
) {
  try {
    storage.removeItem(storageKey(orderId));
  } catch {
    // Storage cleanup should never block the checkout or success flow.
  }
}
