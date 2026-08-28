import {
  PHOTO_PICKER_IMAGE_COUNT,
  PHOTO_PICKER_MAX_IMAGE_BYTES,
  createPhotoPick,
  isJpegBytes,
  isValidPhotoPickerId,
  normalizePhotoPickForClient,
  photoPickForClient,
  photoPickerCacheKey,
} from "@/lib/server/photo-picker";
import { verifyPhotoTestOrderToken } from "@/lib/server/photo-test-order-token";
import {
  r2ObjectExists,
  readR2Json,
  writeR2Json,
} from "@/lib/server/r2";

export const runtime = "nodejs";
export const maxDuration = 20;

const MAX_MULTIPART_BYTES = Math.floor(2.5 * 1024 * 1024);
const MAX_ORDER_TOKEN_LENGTH = 20_000;
const allowedFields = new Set(["orderToken", "pickId", "images"]);

function jsonError(message: string, status = 400) {
  return Response.json(
    { ok: false, error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function jsonSuccess(
  pick: ReturnType<typeof photoPickForClient>,
  cached: boolean,
) {
  return Response.json(
    { ok: true, pick, cached },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function formDataSize(formData: FormData) {
  let size = 0;
  const encoder = new TextEncoder();

  for (const [name, value] of formData.entries()) {
    size += encoder.encode(name).byteLength + 256;
    const entry: unknown = value;
    if (typeof entry === "string") {
      size += encoder.encode(entry).byteLength;
    } else if (entry instanceof Blob) {
      size += entry.size;
    } else {
      return Number.POSITIVE_INFINITY;
    }
  }

  return size;
}

function hasOnlyExpectedFields(formData: FormData) {
  return Array.from(formData.keys()).every((field) => allowedFields.has(field));
}

function validSignedPhotoKeys(orderId: string, r2Keys: unknown) {
  if (!Array.isArray(r2Keys) || r2Keys.length !== PHOTO_PICKER_IMAGE_COUNT) {
    return false;
  }
  if (new Set(r2Keys).size !== PHOTO_PICKER_IMAGE_COUNT) return false;

  const prefix = `photo-tests/${orderId}/`;
  return r2Keys.every(
    (key) =>
      typeof key === "string" &&
      key.length > prefix.length &&
      key.length <= 1_024 &&
      key.startsWith(prefix) &&
      !key.includes("..") &&
      !key.includes("\\") &&
      !/[\r\n]/.test(key),
  );
}

export async function POST(request: Request) {
  if (process.env.PHOTO_PICKER_ENABLED !== "true") {
    return jsonError("Photo picker is unavailable.", 404);
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MULTIPART_BYTES) {
    return jsonError("Photos are too large.", 413);
  }

  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) {
    return jsonError("Invalid photo picker request.");
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError("Invalid photo picker request.");
  }

  if (formDataSize(formData) > MAX_MULTIPART_BYTES) {
    return jsonError("Photos are too large.", 413);
  }
  if (!hasOnlyExpectedFields(formData)) {
    return jsonError("Invalid photo picker request.");
  }

  const orderTokens = formData.getAll("orderToken");
  const pickIds = formData.getAll("pickId");
  const images = formData.getAll("images");
  const orderToken = orderTokens[0];
  const pickId = pickIds[0];

  if (
    orderTokens.length !== 1 ||
    typeof orderToken !== "string" ||
    !orderToken ||
    orderToken.length > MAX_ORDER_TOKEN_LENGTH ||
    pickIds.length !== 1 ||
    !isValidPhotoPickerId(pickId)
  ) {
    return jsonError("Photo picker request is invalid or expired.");
  }

  if (
    images.length !== PHOTO_PICKER_IMAGE_COUNT ||
    images.some(
      (image) =>
        typeof image === "string" ||
        image.type !== "image/jpeg" ||
        image.size === 0 ||
        image.size > PHOTO_PICKER_MAX_IMAGE_BYTES,
    )
  ) {
    return jsonError("Upload exactly three JPEG photos.");
  }

  let order: ReturnType<typeof verifyPhotoTestOrderToken>;
  try {
    order = verifyPhotoTestOrderToken(orderToken);
  } catch {
    return jsonError("Photo picker request is invalid or expired.");
  }

  let cacheKey: string;
  try {
    cacheKey = photoPickerCacheKey(order.orderId);
  } catch {
    return jsonError("Photo picker order is invalid.", 409);
  }

  if (
    order.packageId !== "best_of_three" ||
    !validSignedPhotoKeys(order.orderId, order.r2Keys)
  ) {
    return jsonError("Photo picker order is invalid.", 409);
  }

  let imageBytes: Uint8Array[];
  try {
    imageBytes = await Promise.all(
      images.map(async (image) =>
        typeof image === "string"
          ? new Uint8Array()
          : new Uint8Array(await image.arrayBuffer()),
      ),
    );
  } catch {
    return jsonError("Upload exactly three valid JPEG photos.");
  }

  if (imageBytes.some((image) => !isJpegBytes(image))) {
    return jsonError("Upload exactly three valid JPEG photos.");
  }

  const uploaded = await Promise.all(
    order.r2Keys.map((key) => r2ObjectExists(key)),
  );
  if (uploaded.some((exists) => !exists)) {
    return jsonError(
      "Photo uploads are still finishing. Try again in a moment.",
      409,
    );
  }

  try {
    const cached = normalizePhotoPickForClient(
      await readR2Json<unknown>(cacheKey),
    );
    if (cached) return jsonSuccess(cached, true);
  } catch {
    console.error("Photo picker cache read failed.");
  }

  let pick: Awaited<ReturnType<typeof createPhotoPick>>;
  try {
    pick = await createPhotoPick({ imageBytes, pickId });
  } catch {
    console.error("Photo picker generation failed.");
    return jsonError("Could not compare these photos right now.", 503);
  }

  const publicPick = photoPickForClient(pick);
  try {
    await writeR2Json(cacheKey, publicPick);
  } catch {
    console.error("Photo picker cache write failed.");
    return jsonError("Could not save your selected photo. Try again.", 503);
  }

  return jsonSuccess(publicPick, false);
}
