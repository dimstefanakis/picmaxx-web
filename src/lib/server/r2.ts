import {
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
