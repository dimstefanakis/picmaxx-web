import { sendMetaPageViewEvent } from "@/lib/server/meta";

export const runtime = "nodejs";

type PageViewBody = {
  eventId?: unknown;
  sourceUrl?: unknown;
  referrer?: unknown;
  fbp?: unknown;
  fbc?: unknown;
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value.slice(0, 4000) : "";
}

function clientIp(headers: Headers) {
  const forwardedFor =
    headers.get("cf-connecting-ip") ??
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for") ??
    "";
  return forwardedFor.split(",")[0]?.trim() ?? "";
}

export async function POST(request: Request) {
  let body: PageViewBody;

  try {
    body = (await request.json()) as PageViewBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const eventId = stringValue(body.eventId) || crypto.randomUUID();
  const sourceUrl = stringValue(body.sourceUrl);

  if (!sourceUrl) {
    return Response.json({ ok: false, error: "Missing sourceUrl" }, { status: 400 });
  }

  const metaResponse = await sendMetaPageViewEvent({
    eventId,
    sourceUrl,
    userAgent: request.headers.get("user-agent") ?? "",
    ipAddress: clientIp(request.headers),
    fbp: stringValue(body.fbp),
    fbc: stringValue(body.fbc),
  });

  return Response.json({
    ok: metaResponse.ok,
    eventId,
    status: metaResponse.status,
    referrer: stringValue(body.referrer),
  });
}
