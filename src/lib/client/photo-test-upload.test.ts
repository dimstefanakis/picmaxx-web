import { describe, expect, it, mock } from "bun:test";

import {
  PHOTO_UPLOAD_ATTEMPTS,
  type PhotoUploadFetch,
  PhotoUploadCancelledError,
  PhotoUploadError,
  isRetryableUploadStatus,
  pendingPhotoIndexes,
  uploadPhotoWithRetry,
} from "./photo-test-upload";

const descriptor = {
  uploadUrl: "https://uploads.example/photo",
  headers: { "Content-Type": "image/jpeg" },
};
const file = new Blob(["photo"], { type: "image/jpeg" });

describe("photo test upload retry policy", () => {
  it("retries timeout once and then surfaces a stable failure", async () => {
    const fetchImplementation = mock(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const onRetry = mock(() => undefined);

    let failure: unknown;
    try {
      await uploadPhotoWithRetry({
        descriptor,
        file,
        photoPosition: 2,
        timeoutMs: 1,
        retryDelayMs: 0,
        fetchImplementation,
        onRetry,
      });
    } catch (error) {
      failure = error;
    }

    expect(fetchImplementation).toHaveBeenCalledTimes(PHOTO_UPLOAD_ATTEMPTS);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(failure).toBeInstanceOf(PhotoUploadError);
    expect(failure).toMatchObject({
      code: "upload_timeout",
      attempt: 2,
      photoPosition: 2,
      retryable: true,
    });
  });

  it("retries a network error once and can recover", async () => {
    let fetchCount = 0;
    const fetchImplementation = mock<PhotoUploadFetch>(async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        throw new TypeError("Network unavailable");
      }
      return new Response(null, { status: 200 });
    });
    const retryFailures: PhotoUploadError[] = [];

    await uploadPhotoWithRetry({
      descriptor,
      file,
      photoPosition: 1,
      retryDelayMs: 0,
      fetchImplementation,
      onRetry: (failure) => retryFailures.push(failure),
    });

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(retryFailures).toHaveLength(1);
    expect(retryFailures[0]).toMatchObject({
      code: "upload_network",
      attempt: 1,
    });
  });

  for (const status of [408, 429, 500, 503]) {
    it(`retries HTTP ${status} exactly once`, async () => {
      const fetchImplementation = mock(
        async () => new Response(null, { status }),
      );

      await expect(
        uploadPhotoWithRetry({
          descriptor,
          file,
          photoPosition: 1,
          retryDelayMs: 0,
          fetchImplementation,
        }),
      ).rejects.toMatchObject({
        code: "upload_http",
        status,
        attempt: 2,
        retryable: true,
      });
      expect(fetchImplementation).toHaveBeenCalledTimes(2);
    });
  }

  for (const status of [400, 401, 403, 422]) {
    it(`does not retry HTTP ${status}`, async () => {
      const fetchImplementation = mock(
        async () => new Response(null, { status }),
      );

      await expect(
        uploadPhotoWithRetry({
          descriptor,
          file,
          photoPosition: 3,
          retryDelayMs: 0,
          fetchImplementation,
        }),
      ).rejects.toMatchObject({
        code: "upload_http",
        status,
        attempt: 1,
        retryable: false,
      });
      expect(fetchImplementation).toHaveBeenCalledTimes(1);
    });
  }

  it("cancels immediately without retrying", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImplementation = mock(async () => new Response(null));

    await expect(
      uploadPhotoWithRetry({
        descriptor,
        file,
        photoPosition: 1,
        signal: controller.signal,
        fetchImplementation,
      }),
    ).rejects.toBeInstanceOf(PhotoUploadCancelledError);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("returns only unfinished upload slots", () => {
    expect(pendingPhotoIndexes(3, new Set([0, 2]))).toEqual([1]);
    expect(pendingPhotoIndexes(3, new Set([0, 1, 2]))).toEqual([]);
  });

  it("classifies only timeout-style and server statuses as retryable", () => {
    expect(isRetryableUploadStatus(408)).toBe(true);
    expect(isRetryableUploadStatus(429)).toBe(true);
    expect(isRetryableUploadStatus(500)).toBe(true);
    expect(isRetryableUploadStatus(400)).toBe(false);
    expect(isRetryableUploadStatus(403)).toBe(false);
  });
});
