export const TIKTOK_PIXEL_ID = "DA7FS1RC77UC8FLJ6UT0";

const TIKTOK_VIEW_CONTENT_PATHS = new Set(["/", "/test", "/photo-test"]);

export type TikTokEventName =
  | "ViewContent"
  | "InitiateCheckout"
  | "Purchase";

export type TikTokEventProperties = {
  contents: {
    content_id: string;
    content_name: string;
    price: number;
    quantity: number;
  }[];
  content_type: "product";
  currency: string;
  value: number;
};

type TikTokPixelQueue = {
  track?: (
    eventName: TikTokEventName,
    properties: TikTokEventProperties,
    options?: { event_id: string },
  ) => void;
};

declare global {
  interface Window {
    ttq?: TikTokPixelQueue;
  }
}

export function createTikTokCommerceProperties({
  contentId,
  contentName,
  value,
  currency,
}: {
  contentId: string;
  contentName: string;
  value: number;
  currency: string;
}): TikTokEventProperties {
  return {
    contents: [
      {
        content_id: contentId,
        content_name: contentName,
        price: value,
        quantity: 1,
      },
    ],
    content_type: "product",
    currency: currency.toUpperCase(),
    value,
  };
}

export function createTikTokViewContentProperties({
  pathname,
  value,
  currency,
}: {
  pathname: string;
  value: number;
  currency: string;
}) {
  const isAdPhotoTest = pathname === "/photo-test";
  return createTikTokCommerceProperties({
    contentId: isAdPhotoTest ? "best_of_three" : "photo_test",
    contentName: isAdPhotoTest
      ? "Picmaxx Best Photo Test"
      : "Picmaxx Paid Photo Test",
    value,
    currency,
  });
}

export function isTikTokViewContentPath(pathname: string) {
  return TIKTOK_VIEW_CONTENT_PATHS.has(pathname);
}

export function splitTikTokClickIdForMetadata(ttclid: string) {
  return [ttclid.slice(0, 500), ttclid.slice(500, 1000)] as const;
}

export function joinTikTokClickIdFromMetadata(
  firstPart: string,
  secondPart: string,
) {
  return firstPart + secondPart;
}

export function createTikTokEventId(prefix: string) {
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${randomPart}`;
}

export function trackTikTokEvent({
  eventName,
  eventId,
  properties,
}: {
  eventName: TikTokEventName;
  eventId: string;
  properties: TikTokEventProperties;
}) {
  if (typeof window === "undefined" || typeof window.ttq?.track !== "function") {
    return false;
  }

  window.ttq.track(eventName, properties, { event_id: eventId });
  return true;
}

function browserCookie(name: string) {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

export function getTikTokBrowserIdentifiers() {
  if (typeof window === "undefined") {
    return { ttp: "", ttclid: "" };
  }

  return {
    ttp: browserCookie("_ttp"),
    ttclid:
      new URLSearchParams(window.location.search).get("ttclid") ||
      browserCookie("ttclid"),
  };
}
