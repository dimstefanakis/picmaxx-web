export const PHOTO_UPLOAD_ATTEMPTS = 2;
export const PHOTO_UPLOAD_TIMEOUT_MS = 25_000;

const PHOTO_UPLOAD_RETRY_DELAY_MS = 500;

export type PhotoUploadDescriptor = {
  uploadUrl: string;
  headers: Record<string, string>;
};

export type PhotoUploadFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type PhotoUploadFailureCode =
  | "upload_timeout"
  | "upload_network"
  | "upload_http";

export class PhotoUploadError extends Error {
  readonly code: PhotoUploadFailureCode;
  readonly status?: number;
  readonly retryable: boolean;
  readonly attempt: number;
  readonly photoPosition: number;

  constructor({
    message,
    code,
    status,
    retryable,
    attempt,
    photoPosition,
  }: {
    message: string;
    code: PhotoUploadFailureCode;
    status?: number;
    retryable: boolean;
    attempt: number;
    photoPosition: number;
  }) {
    super(message);
    this.name = "PhotoUploadError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.attempt = attempt;
    this.photoPosition = photoPosition;
  }
}

export class PhotoUploadCancelledError extends Error {
  constructor() {
    super("Photo upload cancelled.");
    this.name = "PhotoUploadCancelledError";
  }
}

export function isPhotoUploadCancelled(error: unknown) {
  return error instanceof PhotoUploadCancelledError;
}

export function isRetryableUploadStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

export function pendingPhotoIndexes(
  uploadCount: number,
  completedIndexes: ReadonlySet<number>,
) {
  return Array.from({ length: uploadCount }, (_, index) => index).filter(
    (index) => !completedIndexes.has(index),
  );
}

function waitForRetry(delayMs: number, signal?: AbortSignal) {
  if (signal?.aborted) {
    return Promise.reject(new PhotoUploadCancelledError());
  }

  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);

    function abort() {
      clearTimeout(timeoutId);
      reject(new PhotoUploadCancelledError());
    }

    signal?.addEventListener("abort", abort, { once: true });
  });
}

function uploadMessage(code: PhotoUploadFailureCode) {
  if (code === "upload_timeout") {
    return "Photo upload timed out. Try again.";
  }
  if (code === "upload_network") {
    return "Photo upload lost connection. Try again.";
  }
  return "Photo upload failed. Try again.";
}

export async function uploadPhotoWithRetry({
  descriptor,
  file,
  photoPosition,
  signal,
  timeoutMs = PHOTO_UPLOAD_TIMEOUT_MS,
  retryDelayMs = PHOTO_UPLOAD_RETRY_DELAY_MS,
  fetchImplementation = fetch,
  onRetry,
}: {
  descriptor: PhotoUploadDescriptor;
  file: Blob;
  photoPosition: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  retryDelayMs?: number;
  fetchImplementation?: PhotoUploadFetch;
  onRetry?: (failure: PhotoUploadError) => void;
}) {
  for (let attempt = 1; attempt <= PHOTO_UPLOAD_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw new PhotoUploadCancelledError();

    const attemptController = new AbortController();
    let timedOut = false;
    const abortAttempt = () => attemptController.abort();
    signal?.addEventListener("abort", abortAttempt, { once: true });
    const timeoutId = setTimeout(() => {
      timedOut = true;
      attemptController.abort();
    }, timeoutMs);

    let failure: PhotoUploadError | null = null;

    try {
      const response = await fetchImplementation(descriptor.uploadUrl, {
        method: "PUT",
        headers: descriptor.headers,
        body: file,
        signal: attemptController.signal,
      });

      if (response.ok) return;

      failure = new PhotoUploadError({
        message: uploadMessage("upload_http"),
        code: "upload_http",
        status: response.status,
        retryable: isRetryableUploadStatus(response.status),
        attempt,
        photoPosition,
      });
    } catch {
      if (signal?.aborted && !timedOut) {
        throw new PhotoUploadCancelledError();
      }

      const code = timedOut ? "upload_timeout" : "upload_network";
      failure = new PhotoUploadError({
        message: uploadMessage(code),
        code,
        retryable: true,
        attempt,
        photoPosition,
      });
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abortAttempt);
    }

    if (!failure.retryable || attempt === PHOTO_UPLOAD_ATTEMPTS) {
      throw failure;
    }

    onRetry?.(failure);
    await waitForRetry(retryDelayMs, signal);
  }
}
