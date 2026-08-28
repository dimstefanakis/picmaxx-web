import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { requiredEnv } from "@/lib/server/env";

let client: S3Client | null = null;

function r2Client() {
  client ??= new S3Client({
    region: "auto",
    endpoint: `https://${requiredEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
    },
  });

  return client;
}

export function r2Bucket() {
  return requiredEnv("R2_BUCKET");
}

export async function createUploadUrl({
  key,
  contentType,
}: {
  key: string;
  contentType: string;
}) {
  const uploadUrl = await getSignedUrl(
    r2Client(),
    new PutObjectCommand({
      Bucket: r2Bucket(),
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: 60 * 10 },
  );

  return {
    key,
    uploadUrl,
    headers: {
      "Content-Type": contentType,
    },
  };
}

export async function r2ObjectExists(key: string) {
  try {
    await r2Client().send(
      new HeadObjectCommand({
        Bucket: r2Bucket(),
        Key: key,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

function isMissingObjectError(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const candidate = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };

  return (
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

export async function readR2Json<T>(key: string): Promise<T | null> {
  try {
    const object = await r2Client().send(
      new GetObjectCommand({
        Bucket: r2Bucket(),
        Key: key,
      }),
    );
    const body = await object.Body?.transformToString("utf-8");
    return body ? (JSON.parse(body) as T) : null;
  } catch (error) {
    if (isMissingObjectError(error)) return null;
    throw error;
  }
}

export async function writeR2Json(key: string, value: unknown) {
  await r2Client().send(
    new PutObjectCommand({
      Bucket: r2Bucket(),
      Key: key,
      Body: JSON.stringify(value),
      ContentType: "application/json; charset=utf-8",
      CacheControl: "private, no-store",
    }),
  );
}
