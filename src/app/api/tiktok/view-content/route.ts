import {
  PHOTO_TEST_CURRENCY,
  PHOTO_TEST_PRICE_CENTS,
} from "@/lib/photo-test";
import { sendTikTokViewContentEvent } from "@/lib/server/tiktok";
import {
  createTikTokViewContentProperties,
  isTikTokViewContentPath,
} from "@/lib/tiktok";

export const runtime = "nodejs";
export const maxDuration = 35;

type ViewContentBody = {
  eventId?: unknown;
  sourceUrl?: unknown;
  referrer?: unknown;
  ttp?: unknown;
  ttclid?: unknown;
};

function stringValue(value: unknown, maxLength = 4000) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function identifierValue(value: unknown, maxLength: number) {
  return typeof value === "string" && value.length <= maxLength ? value : "";
}

function clientIp(headers: Headers) {
  const forwardedFor =
    headers.get("cf-connecting-ip") ??
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for") ??
    "";
  return forwardedFor.split(",")[0]?.trim() ?? "";
}

function sourcePage(sourceUrl: string, requestUrl: string) {
  try {
    const source = new URL(sourceUrl);
    const requestOrigin = new URL(requestUrl).origin;
    if (
      (source.protocol !== "http:" && source.protocol !== "https:") ||
      source.origin !== requestOrigin ||
      !isTikTokViewContentPath(source.pathname)
    ) {
      return null;
    }
    return source;
  } catch {
    return null;
  }
}

function cookieValue(headers: Headers, name: string, maxLength: number) {
  const cookie = headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (!cookie) return "";

  try {
    const decoded = decodeURIComponent(cookie);
    return decoded.length <= maxLength ? decoded : "";
  } catch {
    return cookie.length <= maxLength ? cookie : "";
  }
}

export async function POST(request: Request) {
  let body: ViewContentBody;

  try {
    body = (await request.json()) as ViewContentBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const sourceUrl = stringValue(body.sourceUrl);
  const source = sourcePage(sourceUrl, request.url);
  if (!source) {
    return Response.json(
      { ok: false, error: "Invalid ViewContent event" },
      { status: 400 },
    );
  }

  try {
    const eventId = stringValue(body.eventId, 500) || crypto.randomUUID();
    const tiktokResponse = await sendTikTokViewContentEvent({
      eventId,
      sourceUrl,
      referrer: stringValue(body.referrer),
      userAgent: request.headers.get("user-agent") ?? "",
      ipAddress: clientIp(request.headers),
      ttp:
        identifierValue(body.ttp, 500) ||
        cookieValue(request.headers, "_ttp", 500),
      ttclid:
        identifierValue(body.ttclid, 1000) ||
        cookieValue(request.headers, "ttclid", 1000),
      properties: createTikTokViewContentProperties({
        pathname: source.pathname,
        value: PHOTO_TEST_PRICE_CENTS / 100,
        currency: PHOTO_TEST_CURRENCY,
      }),
    });

    return Response.json({
      ok: tiktokResponse.ok,
      eventId,
      status: tiktokResponse.status,
    });
  } catch (error) {
    console.error(error);
    return Response.json(
      { ok: false, error: "TikTok Events API unavailable" },
      { status: 502 },
    );
  }
}
