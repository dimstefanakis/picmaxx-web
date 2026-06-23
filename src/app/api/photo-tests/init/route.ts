import {
  extensionForImageType,
  isValidPhotoCount,
  isPhotoTestPackageId,
  isValidEmail,
  isVoterAgeRange,
  normalizeEmail,
  photoCountLabel,
  photoTestPackages,
  validatePhotoMeta,
  type PhotoUploadMeta,
} from "@/lib/photo-test";
import { createPaidTestRecord } from "@/lib/server/airtable";
import { createPhotoTestOrderToken } from "@/lib/server/photo-test-order-token";
import { createUploadUrl } from "@/lib/server/r2";

export const runtime = "nodejs";

type InitBody = {
  packageId?: unknown;
  email?: unknown;
  voterAgeRange?: unknown;
  files?: PhotoUploadMeta[];
  sourceUrl?: unknown;
  referrer?: unknown;
  fbp?: unknown;
  fbc?: unknown;
  returnPath?: unknown;
};

function jsonError(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

function cleanSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "");
}

function orderId() {
  return `pmx_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}

function clientIp(headers: Headers) {
  const forwardedFor =
    headers.get("cf-connecting-ip") ??
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for") ??
    "";
  return forwardedFor.split(",")[0]?.trim() ?? "";
}

function checkoutReturnPath(value: unknown) {
  if (value === "/photo-test") return value;
  return undefined;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as InitBody;

    if (!isPhotoTestPackageId(body.packageId)) {
      return jsonError("Choose a valid package.");
    }

    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) {
      return jsonError("Enter a valid email.");
    }

    if (!isVoterAgeRange(body.voterAgeRange)) {
      return jsonError("Choose a valid voter age range.");
    }

    const config = photoTestPackages[body.packageId];
    const files = Array.isArray(body.files) ? body.files : [];
    if (!isValidPhotoCount(body.packageId, files.length)) {
      return jsonError(
        `${config.title} requires ${photoCountLabel(body.packageId)}.`,
      );
    }

    const id = orderId();
    const uploads = [];

    for (const [index, file] of files.entries()) {
      const validation = validatePhotoMeta(file);
      if (!validation.ok) {
        return jsonError(validation.error);
      }

      const key = [
        "photo-tests",
        id,
        `${String(index + 1).padStart(2, "0")}-${cleanSegment(file.name.split(".")[0] || "photo")}.${extensionForImageType(validation.contentType)}`,
      ].join("/");

      uploads.push(
        await createUploadUrl({
          key,
          contentType: validation.contentType,
        }),
      );
    }

    const now = new Date().toISOString();
    const r2Keys = uploads.map((upload) => upload.key);
    const sourceUrl = String(body.sourceUrl ?? "");
    const referrer = String(body.referrer ?? "");
    const fbp = String(body.fbp ?? "");
    const fbc = String(body.fbc ?? "");
    const userAgent = request.headers.get("user-agent") ?? "";
    const ipAddress = clientIp(request.headers);
    const returnPath = checkoutReturnPath(body.returnPath);
    const record = await createPaidTestRecord({
      "Order ID": id,
      Email: email,
      Package: config.airtableLabel,
      "Package ID": config.id,
      "Voter Age Range": body.voterAgeRange,
      Status: "upload_pending",
      "Payment Status": "not_started",
      Amount: 900,
      Currency: "USD",
      "R2 Keys": r2Keys.join("\n"),
      "Source URL": sourceUrl,
      Referrer: referrer,
      FBP: fbp,
      FBC: fbc,
      "Created At": now,
      "Results Status": "not_started",
    });

    const orderToken = createPhotoTestOrderToken({
      orderId: id,
      airtableRecordId: record.id,
      packageId: body.packageId,
      email,
      r2Keys,
      sourceUrl,
      referrer,
      fbp,
      fbc,
      userAgent,
      ipAddress,
      returnPath,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    return Response.json({
      ok: true,
      orderId: id,
      orderToken,
      uploads,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonError("Invalid JSON");
    }
    if (error instanceof Error && error.message.startsWith("Missing ")) {
      return jsonError(`${error.message}. Add it to web/.env.local and restart next dev.`, 500);
    }
    console.error(error);
    return jsonError("Could not start photo test. Check server configuration.", 500);
  }
}
