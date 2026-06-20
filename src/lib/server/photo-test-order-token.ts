import { createHmac, timingSafeEqual } from "node:crypto";

import type { PhotoTestPackageId } from "@/lib/photo-test";
import { requiredEnv } from "@/lib/server/env";

export type PhotoTestOrderTokenPayload = {
  orderId: string;
  airtableRecordId: string;
  packageId: PhotoTestPackageId;
  email: string;
  r2Keys: string[];
  sourceUrl: string;
  referrer: string;
  fbp: string;
  fbc: string;
  userAgent: string;
  ipAddress: string;
  expiresAt: number;
};

function signingSecret() {
  return requiredEnv("STRIPE_SECRET_KEY");
}

function encodeJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeJson<T>(value: string) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

function sign(value: string) {
  return createHmac("sha256", signingSecret()).update(value).digest("base64url");
}

function equalSignatures(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createPhotoTestOrderToken(payload: PhotoTestOrderTokenPayload) {
  const encoded = encodeJson(payload);
  return `${encoded}.${sign(encoded)}`;
}

export function verifyPhotoTestOrderToken(token: unknown) {
  if (typeof token !== "string") {
    throw new Error("Order is missing.");
  }

  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) {
    throw new Error("Order is invalid.");
  }

  if (!equalSignatures(signature, sign(encoded))) {
    throw new Error("Order is invalid.");
  }

  const payload = decodeJson<PhotoTestOrderTokenPayload>(encoded);
  if (!Number.isFinite(payload.expiresAt) || payload.expiresAt < Date.now()) {
    throw new Error("Order expired. Start again.");
  }

  return payload;
}
