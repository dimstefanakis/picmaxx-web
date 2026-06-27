export const PHOTO_TEST_PRICE_CENTS = 900;
export const PHOTO_TEST_CURRENCY = "usd";
export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

export const photoTestPackages = {
  single: {
    id: "single",
    title: "Lead photo score",
    shortTitle: "Lead score",
    price: "$9",
    minPhotoCount: 1,
    maxPhotoCount: 1,
    stripeName: "Picmaxx Lead Photo Score",
    airtableLabel: "Lead photo score",
    eyebrow: "lead photo",
    promise: "Score your current dating app opener.",
    helper: "Best for testing the photo you lead with on Tinder, Hinge, or Bumble.",
    resultCopy: "Female rankings, honest opinions, and an AI edit based on their feedback.",
  },
  best_of_three: {
    id: "best_of_three",
    title: "Find my best photo",
    shortTitle: "Best photo",
    price: "$9",
    minPhotoCount: 2,
    maxPhotoCount: 3,
    stripeName: "Picmaxx Best Photo Test",
    airtableLabel: "Find my best photo",
    eyebrow: "2-3 photos",
    promise: "20 women pick the photo most likely to get you matches.",
    helper: "Best for choosing what to use first on Hinge, Tinder, or Bumble.",
    resultCopy: "Winner, ranking, and light signal on each photo.",
  },
} as const;

export type PhotoTestPackageId = keyof typeof photoTestPackages;

export const voterAgeRanges = [
  {
    value: "18-24",
    label: "18-24",
    helper: "Early dating app crowd",
  },
  {
    value: "25-34",
    label: "25-34",
    helper: "Most common dating pool",
  },
  {
    value: "35-44",
    label: "35-44",
    helper: "More settled daters",
  },
  {
    value: "45+",
    label: "45+",
    helper: "Mature audience",
  },
] as const;

export type VoterAgeRange = (typeof voterAgeRanges)[number]["value"];

export type PhotoUploadMeta = {
  name: string;
  type: string;
  size: number;
};

const allowedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const extensionByType: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export function isPhotoTestPackageId(value: unknown): value is PhotoTestPackageId {
  return typeof value === "string" && value in photoTestPackages;
}

export function isVoterAgeRange(value: unknown): value is VoterAgeRange {
  return typeof value === "string" && voterAgeRanges.some((range) => range.value === value);
}

export function isValidPhotoCount(packageId: PhotoTestPackageId, count: number) {
  const config = photoTestPackages[packageId];
  return count >= config.minPhotoCount && count <= config.maxPhotoCount;
}

export function photoCountLabel(packageId: PhotoTestPackageId) {
  const config = photoTestPackages[packageId];
  if (config.minPhotoCount === config.maxPhotoCount) {
    return `${config.minPhotoCount} photo${config.minPhotoCount === 1 ? "" : "s"}`;
  }

  return `${config.minPhotoCount} or ${config.maxPhotoCount} photos`;
}

export function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function inferImageType(fileName: string, reportedType: string) {
  const type = reportedType.trim().toLowerCase();
  if (allowedImageTypes.has(type)) return type;

  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "heic") return "image/heic";
  if (extension === "heif") return "image/heif";
  return "";
}

export function extensionForImageType(type: string) {
  return extensionByType[type] ?? "jpg";
}

export function validatePhotoMeta(file: PhotoUploadMeta) {
  const contentType = inferImageType(file.name, file.type);

  if (!contentType) {
    return { ok: false as const, error: "Use a JPG, PNG, WEBP, HEIC, or HEIF photo." };
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false as const, error: "Photo file is empty." };
  }

  if (file.size > MAX_PHOTO_BYTES) {
    return { ok: false as const, error: "Each photo must be 12 MB or smaller." };
  }

  return { ok: true as const, contentType };
}
