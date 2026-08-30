"use client";

import Image from "next/image";
import {
  type CSSProperties,
  ChangeEvent,
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import posthog from "posthog-js";

import {
  PHOTO_TEST_CURRENCY,
  PHOTO_TEST_PRICE_CENTS,
  PhotoTestPackageId,
  VoterAgeRange,
  inferImageType,
  photoTestPackages,
  validatePhotoMeta,
  voterAgeRanges,
} from "@/lib/photo-test";
import {
  PhotoUploadError,
  isPhotoUploadCancelled,
  pendingPhotoIndexes,
  uploadPhotoWithRetry,
} from "@/lib/client/photo-test-upload";
import {
  createTikTokCommerceProperties,
  getTikTokBrowserIdentifiers,
  trackTikTokEvent,
} from "@/lib/tiktok";
import styles from "./photo-test.module.css";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

type SelectedPhoto = {
  file: File;
  displayName: string;
  previewUrl: string;
};

type UploadResponse = {
  ok: true;
  orderId: string;
  orderToken: string;
  uploads: {
    key: string;
    uploadUrl: string;
    headers: Record<string, string>;
  }[];
};

type PhotoPickBase = {
  version: "photo_picker_v1";
  winnerIndex: 0 | 1 | 2;
  confidence: "clear" | "close";
  reason: string;
};

type PhotoPickNarrative = {
  setQuality: "strong" | "usable" | "weak";
  headline: string;
  strength: string | null;
  diagnosis: string;
  bridge: string;
};

type PhotoPick = PhotoPickBase | (PhotoPickBase & PhotoPickNarrative);

type PhotoPickResponse = {
  ok: true;
  pick: PhotoPick;
  cached: boolean;
};

type StepId = "intro" | "how" | "upload" | "winner" | "range";
type PipelineStage =
  | "idle"
  | "creating_order"
  | "uploading"
  | "preparing_photos"
  | "picking";
type FlowFailureStage =
  | "photo_validation"
  | "photo_preparation"
  | "order_init"
  | "r2_upload"
  | "analysis_copy"
  | "picker_request"
  | "picker_response"
  | "checkout_validation"
  | "checkout";

type UploadSession = {
  response: UploadResponse;
  completedIndexes: Set<number>;
  retryCount: number;
};

class PhotoTestFlowError extends Error {
  readonly stage: FlowFailureStage;
  readonly code: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor({
    message,
    stage,
    code,
    status,
    retryable = false,
  }: {
    message: string;
    stage: FlowFailureStage;
    code: string;
    status?: number;
    retryable?: boolean;
  }) {
    super(message);
    this.name = "PhotoTestFlowError";
    this.stage = stage;
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const returnPath = "/photo-test";
const adPackageId: PhotoTestPackageId = "best_of_three";
const requiredPhotoCount = 3;
const maxAnalysisDimension = 1024;
const maxAnalysisBytes = 750 * 1024;
const stepOrder: StepId[] = ["intro", "how", "upload", "winner", "range"];
const nextLabelByStep: Record<StepId, string> = {
  intro: "Get more matches",
  how: "Choose my pics",
  upload: "Find my best pic",
  winner: "See how it performs IRL",
  range: "Next",
};
const comparisonPhotos = {
  before: {
    src: "/demo-photos/picmaxx-before.webp",
    label: "old lead",
    matches: "8 matches",
    score: "4.8/10",
  },
  after: {
    src: "/demo-photos/picmaxx-after.webp",
    label: "new lead",
    matches: "41 matches",
    score: "8.7/10",
  },
};

function getCookie(name: string) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

async function parseError(response: Response) {
  const data = await response.json().catch(() => null);
  return data?.error ?? "Something went wrong. Try again.";
}

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0;
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function nowMs() {
  return performance.now();
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not prepare this photo."));
      },
      "image/jpeg",
      quality,
    );
  });
}

function isHeicPhoto(file: File) {
  const imageType = inferImageType(file.name, file.type);
  return imageType === "image/heic" || imageType === "image/heif";
}

function jpegFileName(fileName: string) {
  const baseName = fileName.replace(/\.(heic|heif)$/i, "") || "photo";
  return `${baseName}.jpg`;
}

async function prepareBrowserPhoto(file: File) {
  if (!isHeicPhoto(file)) return file;

  try {
    const { default: heic2any } = await import("heic2any");
    const converted = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: 0.9,
    });
    const jpeg = Array.isArray(converted) ? converted[0] : converted;
    if (!jpeg) throw new Error("Missing converted photo.");

    return new File([jpeg], jpegFileName(file.name), {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    throw new Error(
      "That HEIC photo could not be opened. Try another photo or export it as JPEG.",
    );
  }
}

function loadBrowserImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.decoding = "async";
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This browser cannot prepare that photo for the instant pick."));
    };
    image.src = url;
  });
}

async function isJpegBlob(blob: Blob) {
  if (blob.type !== "image/jpeg") return false;
  const header = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
  return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
}

async function createAnalysisCopy(file: File) {
  let source: ImageBitmap | HTMLImageElement;

  try {
    source = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    source = await loadBrowserImage(file);
  }

  const initialScale = Math.min(
    1,
    maxAnalysisDimension / Math.max(source.width, source.height),
  );
  let width = Math.max(1, Math.round(source.width * initialScale));
  let height = Math.max(1, Math.round(source.height * initialScale));
  let quality = 0.86;
  let result: Blob | null = null;

  try {
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Could not prepare this photo.");

      context.fillStyle = "#f4efe4";
      context.fillRect(0, 0, width, height);
      context.drawImage(source, 0, 0, width, height);
      result = await canvasToJpeg(canvas, quality);

      if (result.size <= maxAnalysisBytes) break;
      if (quality > 0.58) {
        quality -= 0.08;
      } else {
        width = Math.max(1, Math.round(width * 0.82));
        height = Math.max(1, Math.round(height * 0.82));
        quality = 0.74;
      }
    }
  } finally {
    if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
      source.close();
    }
  }

  if (
    !result ||
    result.size > maxAnalysisBytes ||
    width > maxAnalysisDimension ||
    height > maxAnalysisDimension ||
    !(await isJpegBlob(result))
  ) {
    throw new Error("Could not prepare this photo for the instant pick.");
  }

  return result;
}

function isPhotoPick(value: unknown): value is PhotoPick {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const baseIsValid =
    candidate.version === "photo_picker_v1" &&
    (candidate.winnerIndex === 0 ||
      candidate.winnerIndex === 1 ||
      candidate.winnerIndex === 2) &&
    (candidate.confidence === "clear" || candidate.confidence === "close") &&
    typeof candidate.reason === "string" &&
    candidate.reason.trim().length > 0;

  if (!baseIsValid) return false;

  const narrativeKeys = [
    "setQuality",
    "headline",
    "strength",
    "diagnosis",
    "bridge",
  ];
  if (!narrativeKeys.some((key) => key in candidate)) return true;

  return (
    (candidate.setQuality === "strong" ||
      candidate.setQuality === "usable" ||
      candidate.setQuality === "weak") &&
    typeof candidate.headline === "string" &&
    candidate.headline.trim().length > 0 &&
    (candidate.strength === null ||
      (typeof candidate.strength === "string" &&
        candidate.strength.trim().length > 0)) &&
    typeof candidate.diagnosis === "string" &&
    candidate.diagnosis.trim().length > 0 &&
    typeof candidate.bridge === "string" &&
    candidate.bridge.trim().length > 0
  );
}

function hasPhotoPickNarrative(
  pick: PhotoPick,
): pick is PhotoPickBase & PhotoPickNarrative {
  return "setQuality" in pick;
}

function flowFailureDetails(
  error: unknown,
  fallbackStage: FlowFailureStage,
) {
  if (error instanceof PhotoUploadError) {
    return {
      stage: "r2_upload" as const,
      code: error.code,
      status: error.status,
      retryable: error.retryable,
      attempt: error.attempt,
      photoPosition: error.photoPosition,
    };
  }

  if (error instanceof PhotoTestFlowError) {
    return {
      stage: error.stage,
      code: error.code,
      status: error.status,
      retryable: error.retryable,
      attempt: undefined,
      photoPosition: undefined,
    };
  }

  return {
    stage: fallbackStage,
    code: `${fallbackStage}_failed`,
    status: undefined,
    retryable: false,
    attempt: undefined,
    photoPosition: undefined,
  };
}

export default function PhotoTestAdPage() {
  const [activeStep, setActiveStep] = useState<StepId>("intro");
  const [voterAgeRange, setVoterAgeRange] = useState<VoterAgeRange>("25-34");
  const [photos, setPhotos] = useState<(SelectedPhoto | null)[]>([
    null,
    null,
    null,
  ]);
  const [comparisonSplit, setComparisonSplit] = useState(58);
  const [isDraggingComparison, setIsDraggingComparison] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [orderToken, setOrderToken] = useState("");
  const [originalsUploaded, setOriginalsUploaded] = useState(false);
  const [photoPick, setPhotoPick] = useState<PhotoPick | null>(null);
  const [photosBeingPrepared, setPhotosBeingPrepared] = useState(0);
  const [isPreparingPick, setIsPreparingPick] = useState(false);
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>("idle");
  const [uploadProgress, setUploadProgress] = useState({
    completed: 0,
    total: requiredPhotoCount,
  });
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const photosRef = useRef(photos);
  const preparingPickRef = useRef(false);
  const selectionVersionRef = useRef(0);
  const photoSelectionRef = useRef([0, 0, 0]);
  const uploadSessionRef = useRef<UploadSession | null>(null);
  const activePipelineControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => {
    return () => {
      activePipelineControllerRef.current?.abort();
      photosRef.current.forEach((photo) => {
        if (photo) URL.revokeObjectURL(photo.previewUrl);
      });
    };
  }, []);

  const selectedPackage = photoTestPackages[adPackageId];
  const maxPhotos = selectedPackage.maxPhotoCount;
  const visiblePhotos = photos.slice(0, maxPhotos);
  const readyCount = visiblePhotos.filter(Boolean).length;
  const isPreparingPhoto = photosBeingPrepared > 0;
  const comparisonStyle = {
    "--split": `${comparisonSplit}%`,
  } as CSSProperties;

  const activeStepIndex = stepOrder.indexOf(activeStep);
  const isFirstStep = activeStepIndex === 0;
  const isFinalStep = activeStep === "range";
  const winningPhoto = photoPick ? photos[photoPick.winnerIndex] : null;
  const richPhotoPick =
    photoPick && hasPhotoPickNarrative(photoPick) ? photoPick : null;
  const uploadCtaDisabled =
    activeStep === "upload" && readyCount !== requiredPhotoCount;
  const pipelineStatusCopy =
    pipelineStage === "creating_order"
      ? "Starting upload..."
      : pipelineStage === "uploading"
        ? `Uploading ${uploadProgress.completed} of ${uploadProgress.total}...`
        : pipelineStage === "preparing_photos"
          ? "Preparing your photos..."
          : pipelineStage === "picking"
            ? "Picking your best..."
            : "";

  useEffect(() => {
    posthog.capture("photo_test_step_viewed", {
      step: activeStep,
      step_number: activeStepIndex + 1,
      package_id: adPackageId,
      variant: "ad",
    });
  }, [activeStep, activeStepIndex]);

  function captureFlowFailure({
    stage,
    code,
    status,
    retryable,
    attempt,
    photoPosition,
    orderIdOverride,
    elapsedMs,
  }: {
    stage: FlowFailureStage;
    code: string;
    status?: number;
    retryable?: boolean;
    attempt?: number;
    photoPosition?: number;
    orderIdOverride?: string;
    elapsedMs?: number;
  }) {
    posthog.capture("photo_test_flow_failed", {
      step: activeStep,
      failure_stage: stage,
      failure_code: code,
      package_id: adPackageId,
      variant: "ad",
      ...(orderIdOverride || orderId
        ? { order_id: orderIdOverride || orderId }
        : {}),
      ...(status === undefined ? {} : { http_status: status }),
      ...(retryable === undefined ? {} : { retryable }),
      ...(attempt === undefined ? {} : { attempt }),
      ...(photoPosition === undefined
        ? {}
        : { photo_position: photoPosition }),
      ...(elapsedMs === undefined ? {} : { elapsed_ms: elapsedMs }),
    });
  }

  function resetUploadSession() {
    uploadSessionRef.current = null;
    setUploadProgress({ completed: 0, total: requiredPhotoCount });
  }

  function invalidatePreparedPick() {
    selectionVersionRef.current += 1;
    activePipelineControllerRef.current?.abort();
    resetUploadSession();
    setOrderId("");
    setOrderToken("");
    setOriginalsUploaded(false);
    setPhotoPick(null);
    setPipelineStage("idle");
  }

  function chooseAgeRange(nextRange: VoterAgeRange) {
    posthog.capture("audience_selected", {
      package_id: adPackageId,
      voter_age_range: nextRange,
      variant: "ad",
    });
    setVoterAgeRange(nextRange);
  }

  function updateComparisonFromPointer(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const rawSplit = ((event.clientX - bounds.left) / bounds.width) * 100;
    setComparisonSplit(Math.min(76, Math.max(24, Math.round(rawSplit))));
  }

  function startComparisonDrag(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDraggingComparison(true);
    updateComparisonFromPointer(event);
  }

  function moveComparisonDrag(event: PointerEvent<HTMLDivElement>) {
    if (!isDraggingComparison) return;
    updateComparisonFromPointer(event);
  }

  function stopComparisonDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsDraggingComparison(false);
  }

  async function replacePhoto(
    index: number,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const normalized = {
      name: file.name,
      type: inferImageType(file.name, file.type),
      size: file.size,
    };
    const validation = validatePhotoMeta(normalized);
    if (!validation.ok) {
      setError(validation.error);
      captureFlowFailure({
        stage: "photo_validation",
        code: "photo_metadata_invalid",
        retryable: false,
        photoPosition: index + 1,
      });
      return;
    }

    setError("");
    const selectionAttempt = photoSelectionRef.current[index] + 1;
    photoSelectionRef.current[index] = selectionAttempt;
    setPhotosBeingPrepared((current) => current + 1);

    try {
      const preparedFile = await prepareBrowserPhoto(file);
      if (photoSelectionRef.current[index] !== selectionAttempt) return;

      const preparedValidation = validatePhotoMeta({
        name: preparedFile.name,
        type: preparedFile.type,
        size: preparedFile.size,
      });
      if (!preparedValidation.ok) {
        setError(preparedValidation.error);
        captureFlowFailure({
          stage: "photo_validation",
          code: "prepared_photo_invalid",
          retryable: false,
          photoPosition: index + 1,
        });
        return;
      }

      invalidatePreparedPick();
      posthog.capture("photo_upload_added", {
        photo_index: index,
        package_id: adPackageId,
        converted_from_heic: isHeicPhoto(file),
        variant: "ad",
      });
      setPhotos((current) => {
        const next = [...current];
        const previous = next[index];
        if (previous) URL.revokeObjectURL(previous.previewUrl);
        next[index] = {
          file: preparedFile,
          displayName: file.name,
          previewUrl: URL.createObjectURL(preparedFile),
        };
        return next;
      });
    } catch (photoError) {
      if (photoSelectionRef.current[index] === selectionAttempt) {
        setError(
          photoError instanceof Error
            ? photoError.message
            : "Could not prepare this photo.",
        );
        captureFlowFailure({
          stage: "photo_preparation",
          code: isHeicPhoto(file)
            ? "heic_conversion_failed"
            : "photo_preparation_failed",
          retryable: true,
          photoPosition: index + 1,
        });
      }
    } finally {
      setPhotosBeingPrepared((current) => Math.max(0, current - 1));
    }
  }

  function removePhoto(index: number) {
    photoSelectionRef.current[index] += 1;
    invalidatePreparedPick();
    posthog.capture("photo_test_photo_removed", {
      photo_position: index + 1,
      package_id: adPackageId,
      variant: "ad",
    });
    setPhotos((current) => {
      const next = [...current];
      const previous = next[index];
      if (previous) URL.revokeObjectURL(previous.previewUrl);
      next[index] = null;
      return next;
    });
  }

  function goBack(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (isFirstStep || isPreparingPhoto || isPreparingPick || isSubmitting) {
      return;
    }
    const previousStep = stepOrder[activeStepIndex - 1];
    posthog.capture("photo_test_back_clicked", {
      step: activeStep,
      previous_step: previousStep,
      package_id: adPackageId,
      variant: "ad",
    });
    setError("");
    setActiveStep(previousStep);
  }

  function goNext(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const nextStep =
      activeStep === "upload"
        ? "winner"
        : stepOrder[activeStepIndex + 1];
    posthog.capture("photo_test_cta_clicked", {
      step: activeStep,
      next_step: nextStep,
      cta_label: nextLabelByStep[activeStep],
      package_id: adPackageId,
      variant: "ad",
    });
    if (activeStep === "upload") {
      void preparePhotoPick();
      return;
    }

    if (!nextStep) return;
    setError("");
    setActiveStep(nextStep);
  }

  function validateForm() {
    if (readyCount !== requiredPhotoCount) {
      return "Add all 3 photos.";
    }
    if (!orderToken || !originalsUploaded || !photoPick) {
      return "Pick your best photo first.";
    }
    return "";
  }

  async function createAndUploadOrder(
    finalPhotos: SelectedPhoto[],
    signal: AbortSignal,
  ) {
    let session = uploadSessionRef.current;

    if (!session) {
      setPipelineStage("creating_order");
      const { ttp, ttclid } = getTikTokBrowserIdentifiers();
      let initResponse: Response;

      try {
        initResponse = await fetch("/api/photo-tests/init", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            packageId: adPackageId,
            files: finalPhotos.map(({ file }) => ({
              name: file.name,
              type: inferImageType(file.name, file.type),
              size: file.size,
            })),
            sourceUrl: window.location.href,
            referrer: document.referrer,
            fbp: getCookie("_fbp"),
            fbc: getCookie("_fbc"),
            ttp,
            ttclid,
            posthogDistinctId: posthog.get_distinct_id(),
            posthogSessionId: posthog.get_session_id(),
            returnPath,
          }),
          signal,
        });
      } catch (initError) {
        if (signal.aborted) throw initError;
        throw new PhotoTestFlowError({
          message: "Could not start photo upload. Try again.",
          stage: "order_init",
          code: "order_init_network",
          retryable: true,
        });
      }

      if (!initResponse.ok) {
        throw new PhotoTestFlowError({
          message: await parseError(initResponse),
          stage: "order_init",
          code: "order_init_http",
          status: initResponse.status,
          retryable: initResponse.status >= 500,
        });
      }

      let initData: UploadResponse;
      try {
        initData = (await initResponse.json()) as UploadResponse;
      } catch {
        throw new PhotoTestFlowError({
          message: "Photo upload could not start. Try again.",
          stage: "order_init",
          code: "order_init_response_invalid",
        });
      }

      if (initData.uploads.length !== requiredPhotoCount) {
        throw new PhotoTestFlowError({
          message: "Photo upload could not start. Try again.",
          stage: "order_init",
          code: "upload_descriptors_incomplete",
        });
      }

      session = {
        response: initData,
        completedIndexes: new Set<number>(),
        retryCount: 0,
      };
      uploadSessionRef.current = session;
      setOrderId(initData.orderId);
      setOrderToken(initData.orderToken);
      setOriginalsUploaded(false);
    }

    const activeSession = session;
    const pendingIndexes = pendingPhotoIndexes(
      finalPhotos.length,
      activeSession.completedIndexes,
    );
    setUploadProgress({
      completed: activeSession.completedIndexes.size,
      total: requiredPhotoCount,
    });

    if (pendingIndexes.length > 0) {
      setPipelineStage("uploading");
      const uploadStartedAt = nowMs();
      const retryCountAtStart = activeSession.retryCount;
      posthog.capture("photo_test_upload_started", {
        order_id: activeSession.response.orderId,
        photo_count: requiredPhotoCount,
        pending_count: pendingIndexes.length,
        completed_count: activeSession.completedIndexes.size,
        total_bytes: finalPhotos.reduce(
          (total, photo) => total + photo.file.size,
          0,
        ),
        resumed: activeSession.completedIndexes.size > 0,
        package_id: adPackageId,
        variant: "ad",
      });

      const uploadResults = await Promise.allSettled(
        pendingIndexes.map(async (index) => {
          const upload = activeSession.response.uploads[index];
          const photo = finalPhotos[index];
          if (!upload || !photo) {
            throw new PhotoTestFlowError({
              message: "Photo upload could not start. Try again.",
              stage: "r2_upload",
              code: "upload_descriptor_missing",
            });
          }

          await uploadPhotoWithRetry({
            descriptor: upload,
            file: photo.file,
            photoPosition: index + 1,
            signal,
            onRetry: (failure) => {
              activeSession.retryCount += 1;
              posthog.capture("photo_test_upload_retried", {
                order_id: activeSession.response.orderId,
                photo_position: index + 1,
                attempt: failure.attempt,
                next_attempt: failure.attempt + 1,
                failure_code: failure.code,
                ...(failure.status === undefined
                  ? {}
                  : { http_status: failure.status }),
                package_id: adPackageId,
                variant: "ad",
              });
            },
          });

          if (signal.aborted || uploadSessionRef.current !== activeSession) {
            throw new Error("Photo upload cancelled.");
          }

          activeSession.completedIndexes.add(index);
          setUploadProgress({
            completed: activeSession.completedIndexes.size,
            total: requiredPhotoCount,
          });
        }),
      );

      if (signal.aborted || uploadSessionRef.current !== activeSession) {
        throw new Error("Photo upload cancelled.");
      }

      const rejectedUpload = uploadResults.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (rejectedUpload) {
        if (
          rejectedUpload.reason instanceof PhotoUploadError &&
          !rejectedUpload.reason.retryable
        ) {
          resetUploadSession();
          setOrderId("");
          setOrderToken("");
          setOriginalsUploaded(false);
        }
        throw rejectedUpload.reason;
      }

      posthog.capture("photo_test_upload_completed", {
        order_id: activeSession.response.orderId,
        photo_count: requiredPhotoCount,
        retry_count: activeSession.retryCount - retryCountAtStart,
        duration_ms: Math.round(nowMs() - uploadStartedAt),
        package_id: adPackageId,
        variant: "ad",
      });
    }

    setOriginalsUploaded(true);
    return activeSession.response;
  }

  async function preparePhotoPick() {
    if (preparingPickRef.current) return;
    if (readyCount !== requiredPhotoCount) {
      setError("Add all 3 photos.");
      captureFlowFailure({
        stage: "photo_validation",
        code: "three_photos_required",
        retryable: false,
      });
      return;
    }
    if (photoPick && orderToken && originalsUploaded) {
      setError("");
      setActiveStep("winner");
      return;
    }

    const finalPhotos = visiblePhotos.filter(
      (photo): photo is SelectedPhoto => Boolean(photo),
    );
    if (finalPhotos.length !== requiredPhotoCount) {
      setError("Add all 3 photos.");
      captureFlowFailure({
        stage: "photo_validation",
        code: "three_photos_required",
        retryable: false,
      });
      return;
    }

    const selectionVersion = selectionVersionRef.current;
    const startedAt = nowMs();
    let attemptedOrderId = orderId;
    let pickId = "";
    let failureStage: FlowFailureStage = "order_init";
    const pipelineController = new AbortController();
    activePipelineControllerRef.current = pipelineController;
    preparingPickRef.current = true;
    setError("");
    setIsPreparingPick(true);

    try {
      const uploadResult =
        orderToken && orderId && originalsUploaded
          ? { orderId, orderToken }
          : await createAndUploadOrder(
              finalPhotos,
              pipelineController.signal,
            );

      if (selectionVersion !== selectionVersionRef.current) return;

      const nextOrderId = uploadResult.orderId;
      const nextOrderToken = uploadResult.orderToken;
      attemptedOrderId = nextOrderId;
      setOrderId(nextOrderId);
      setOrderToken(nextOrderToken);
      setOriginalsUploaded(true);

      failureStage = "analysis_copy";
      setPipelineStage("preparing_photos");
      let analysisImages: Blob[];
      try {
        analysisImages = await Promise.all(
          finalPhotos.map(({ file }) => createAnalysisCopy(file)),
        );
      } catch (analysisError) {
        throw new PhotoTestFlowError({
          message:
            analysisError instanceof Error
              ? analysisError.message
              : "Could not prepare these photos. Try again.",
          stage: "analysis_copy",
          code: "analysis_copy_failed",
          retryable: true,
        });
      }
      if (pipelineController.signal.aborted) return;

      pickId = randomId();
      const formData = new FormData();
      formData.set("orderToken", nextOrderToken);
      formData.set("pickId", pickId);
      analysisImages.forEach((image, index) => {
        formData.append("images", image, `photo-${index + 1}.jpg`);
      });

      failureStage = "picker_request";
      setPipelineStage("picking");
      posthog.capture("ai_pick_requested", {
        order_id: nextOrderId,
        pick_id: pickId,
        package_id: adPackageId,
        photo_count: requiredPhotoCount,
        variant: "ad",
      });

      let pickResponse: Response;
      try {
        pickResponse = await fetch("/api/photo-tests/pick", {
          method: "POST",
          body: formData,
          signal: pipelineController.signal,
        });
      } catch (pickError) {
        if (pipelineController.signal.aborted) throw pickError;
        throw new PhotoTestFlowError({
          message: "Could not pick a photo right now. Try again.",
          stage: "picker_request",
          code: "picker_network",
          retryable: true,
        });
      }
      if (!pickResponse.ok) {
        if (
          pickResponse.status === 400 ||
          pickResponse.status === 401 ||
          pickResponse.status === 410
        ) {
          resetUploadSession();
          setOrderId("");
          setOrderToken("");
          setOriginalsUploaded(false);
        }
        throw new PhotoTestFlowError({
          message: await parseError(pickResponse),
          stage: "picker_request",
          code: "picker_http",
          status: pickResponse.status,
          retryable:
            pickResponse.status === 408 ||
            pickResponse.status === 429 ||
            pickResponse.status >= 500,
        });
      }

      failureStage = "picker_response";
      let pickData: PhotoPickResponse;
      try {
        pickData = (await pickResponse.json()) as PhotoPickResponse;
      } catch {
        throw new PhotoTestFlowError({
          message: "Could not pick a photo right now. Try again.",
          stage: "picker_response",
          code: "picker_response_invalid",
          retryable: true,
        });
      }
      if (!isPhotoPick(pickData.pick)) {
        throw new PhotoTestFlowError({
          message: "Could not pick a photo right now. Try again.",
          stage: "picker_response",
          code: "picker_response_invalid",
          retryable: true,
        });
      }
      if (selectionVersion !== selectionVersionRef.current) return;

      setPhotoPick(pickData.pick);
      setError("");
      setActiveStep("winner");
      const richPick = hasPhotoPickNarrative(pickData.pick)
        ? pickData.pick
        : null;
      posthog.capture("ai_pick_revealed", {
        order_id: nextOrderId,
        pick_id: pickId,
        package_id: adPackageId,
        photo_count: requiredPhotoCount,
        winner_position: pickData.pick.winnerIndex + 1,
        ...(richPick
          ? { set_quality: richPick.setQuality }
          : { confidence: pickData.pick.confidence }),
        cached: Boolean(pickData.cached),
        latency_ms: Math.round(nowMs() - startedAt),
        variant: "ad",
      });
    } catch (caught) {
      if (
        pipelineController.signal.aborted ||
        selectionVersion !== selectionVersionRef.current ||
        isPhotoUploadCancelled(caught)
      ) {
        return;
      }
      const message =
        caught instanceof Error
          ? caught.message
          : "Could not pick a photo right now. Try again.";
      const failure = flowFailureDetails(caught, failureStage);
      const failureOrderId =
        attemptedOrderId ||
        uploadSessionRef.current?.response.orderId ||
        undefined;
      setError(message);
      captureFlowFailure({
        stage: failure.stage,
        code: failure.code,
        status: failure.status,
        retryable: failure.retryable,
        attempt: failure.attempt,
        photoPosition: failure.photoPosition,
        orderIdOverride: failureOrderId,
        elapsedMs: Math.round(nowMs() - startedAt),
      });
      posthog.capture("ai_pick_failed", {
        order_id: failureOrderId,
        pick_id: pickId || undefined,
        package_id: adPackageId,
        photo_count: requiredPhotoCount,
        error_message: message,
        failure_stage: failure.stage,
        failure_code: failure.code,
        ...(failure.status === undefined
          ? {}
          : { http_status: failure.status }),
        retryable: failure.retryable,
        ...(failure.attempt === undefined
          ? {}
          : { attempt: failure.attempt }),
        ...(failure.photoPosition === undefined
          ? {}
          : { photo_position: failure.photoPosition }),
        latency_ms: Math.round(nowMs() - startedAt),
        variant: "ad",
      });
    } finally {
      if (activePipelineControllerRef.current === pipelineController) {
        activePipelineControllerRef.current = null;
      }
      preparingPickRef.current = false;
      setIsPreparingPick(false);
      setPipelineStage("idle");
    }
  }

  async function startCheckout() {
    if (isSubmitting) return;
    const checkoutStartedAt = nowMs();
    posthog.capture("photo_test_cta_clicked", {
      step: activeStep,
      next_step: "stripe_checkout",
      cta_label: "Unlock my swipe score",
      package_id: adPackageId,
      order_id: orderId || undefined,
      variant: "ad",
    });
    posthog.capture("photo_test_checkout_attempted", {
      package_id: adPackageId,
      voter_age_range: voterAgeRange,
      photo_count: requiredPhotoCount,
      order_id: orderId || undefined,
      variant: "ad",
    });

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      posthog.capture("photo_test_checkout_failed", {
        failure_stage: "checkout_validation",
        failure_code: "checkout_prerequisites_missing",
        retryable: false,
        package_id: adPackageId,
        order_id: orderId || undefined,
        variant: "ad",
      });
      captureFlowFailure({
        stage: "checkout_validation",
        code: "checkout_prerequisites_missing",
        retryable: false,
        elapsedMs: Math.round(nowMs() - checkoutStartedAt),
      });
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const checkoutResponse = await fetch("/api/photo-tests/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orderToken, voterAgeRange }),
      });

      if (!checkoutResponse.ok) {
        throw new PhotoTestFlowError({
          message: await parseError(checkoutResponse),
          stage: "checkout",
          code: "checkout_http",
          status: checkoutResponse.status,
          retryable:
            checkoutResponse.status === 408 ||
            checkoutResponse.status === 429 ||
            checkoutResponse.status >= 500,
        });
      }
      let checkout: {
        ok: true;
        checkoutUrl: string;
        initiateCheckoutEventId: string;
      };
      try {
        checkout = (await checkoutResponse.json()) as typeof checkout;
      } catch {
        throw new PhotoTestFlowError({
          message: "Could not open checkout. Try again.",
          stage: "checkout",
          code: "checkout_response_invalid",
          retryable: true,
        });
      }

      window.fbq?.(
        "track",
        "InitiateCheckout",
        {
          value: 9,
          currency: "USD",
          content_name: selectedPackage.title,
          content_type: adPackageId,
        },
        { eventID: checkout.initiateCheckoutEventId },
      );
      trackTikTokEvent({
        eventName: "InitiateCheckout",
        eventId: checkout.initiateCheckoutEventId,
        properties: createTikTokCommerceProperties({
          contentId: adPackageId,
          contentName: selectedPackage.title,
          value: PHOTO_TEST_PRICE_CENTS / 100,
          currency: PHOTO_TEST_CURRENCY,
        }),
      });
      posthog.capture(
        "checkout_initiated",
        {
          package_id: adPackageId,
          voter_age_range: voterAgeRange,
          photo_count: requiredPhotoCount,
          order_id: orderId,
          variant: "ad",
        },
        { send_instantly: true, transport: "sendBeacon" },
      );
      window.location.href = checkout.checkoutUrl;
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Something went wrong. Try again.";
      const failure = flowFailureDetails(caught, "checkout");
      setError(message);
      posthog.capture("photo_test_checkout_failed", {
        failure_stage: failure.stage,
        failure_code: failure.code,
        retryable: failure.retryable,
        ...(failure.status === undefined
          ? {}
          : { http_status: failure.status }),
        package_id: adPackageId,
        order_id: orderId || undefined,
        elapsed_ms: Math.round(nowMs() - checkoutStartedAt),
        variant: "ad",
      });
      captureFlowFailure({
        stage: failure.stage,
        code: failure.code,
        status: failure.status,
        retryable: failure.retryable,
        orderIdOverride: orderId || undefined,
        elapsedMs: Math.round(nowMs() - checkoutStartedAt),
      });
      setIsSubmitting(false);
    }
  }

  function renderComparison() {
    const priority = activeStep === "intro";

    return (
      <div className={styles.comparisonPreview}>
        <div
          className={styles.comparisonFrame}
          style={comparisonStyle}
          role="presentation"
          onPointerDown={startComparisonDrag}
          onPointerMove={moveComparisonDrag}
          onPointerUp={stopComparisonDrag}
          onPointerCancel={stopComparisonDrag}
        >
          <div className={`${styles.comparisonLayer} ${styles.comparisonBefore}`}>
            <Image
              src={comparisonPhotos.before.src}
              alt="Example old lead dating photo"
              fill
              priority={priority}
              sizes="(max-width: 720px) 78vw, 360px"
            />
            <div className={styles.comparisonBadge}>
              <span>{comparisonPhotos.before.label}</span>
              <strong>{comparisonPhotos.before.matches}</strong>
            </div>
            <span className={`${styles.scoreBadge} ${styles.scoreBadgeBefore}`}>
              {comparisonPhotos.before.score}
            </span>
          </div>
          <div className={`${styles.comparisonLayer} ${styles.comparisonAfter}`}>
            <Image
              src={comparisonPhotos.after.src}
              alt="Example new lead dating photo"
              fill
              priority={priority}
              sizes="(max-width: 720px) 78vw, 360px"
            />
            <div className={`${styles.comparisonBadge} ${styles.comparisonBadgeAfter}`}>
              <span>{comparisonPhotos.after.label}</span>
              <strong>{comparisonPhotos.after.matches}</strong>
            </div>
            <span className={`${styles.scoreBadge} ${styles.scoreBadgeAfter}`}>
              {comparisonPhotos.after.score}
            </span>
          </div>
          <div className={styles.comparisonDivider} aria-hidden="true" />
        </div>
        <div className={styles.liftBadge}>
          <span>5.1x lift</span>
          <strong>better opener</strong>
        </div>
        <label className={styles.comparisonControl}>
          <span>before</span>
          <input
            type="range"
            min="24"
            max="76"
            value={comparisonSplit}
            onChange={(event) => setComparisonSplit(Number(event.currentTarget.value))}
            aria-label="Reveal the before and after example"
          />
          <span>after</span>
        </label>
      </div>
    );
  }

  function renderStep() {
    if (activeStep === "intro") {
      return (
        <section className={`${styles.stepPanel} ${styles.stepPanelIntro}`} aria-labelledby="photo-test-title">
          <div className={styles.stepCopyBlock}>
            <h1 id="photo-test-title" className={styles.title}>
              Find the dating pic that gets you{" "}
              <span className={styles.titleAccent}>5x more matches</span> on Tinder.
            </h1>
            <p className={styles.subcopy}>
              Your best dating photo might already be in your camera roll. Stop
              losing matches to the wrong first photo.
            </p>
          </div>
          {renderComparison()}
        </section>
      );
    }

    if (activeStep === "how") {
      return (
        <section className={styles.stepPanel} aria-labelledby="how-title">
          <div className={styles.stepCopyBlock}>
            <h2 id="how-title" className={styles.stepTitle}>
              How it works
            </h2>
          </div>
          <div className={styles.signalPanel} aria-labelledby="fact-title">
            <span>The problem</span>
            <strong id="fact-title">
              You can&apos;t see your photos the way <em>women do.</em>
            </strong>
            <p>
              The pic you like most can be the one quietly costing you matches.
            </p>
          </div>
          <h3 className={styles.fixTitle}>The fix</h3>
          <div className={styles.stepCards}>
            <div className={styles.contextItem}>
              <span>01</span>
              <strong>Upload 3 dating pics</strong>
              <p>Add the three you are deciding between.</p>
            </div>
            <div className={styles.contextItem}>
              <span>02</span>
              <strong>Find the best one</strong>
              <p>See which pic should lead your profile.</p>
            </div>
            <div className={styles.contextItem}>
              <span>03</span>
              <strong>Get your swipe score</strong>
              <p>
                20 real women score the winning pic out of 10, so you know how
                it actually lands.
              </p>
            </div>
          </div>
        </section>
      );
    }

    if (activeStep === "upload") {
      return (
        <section className={styles.stepPanel} aria-labelledby="upload-title">
          <div className={styles.stepCopyBlock}>
            <h2 id="upload-title" className={styles.stepTitle}>
              Upload your best 3 dating pics.
            </h2>
          </div>
          <div className={styles.uploadGrid}>
            {Array.from({ length: maxPhotos }).map((_, index) => (
              <PhotoSlot
                key={`lead-${index}`}
                index={index}
                photo={photos[index]}
                disabled={isPreparingPhoto || isPreparingPick}
                onClick={() =>
                  posthog.capture("lead_photo_upload_clicked", {
                    photo_index: index,
                    package_id: adPackageId,
                    variant: "ad",
                  })
                }
                onChange={(event) => replacePhoto(index, event)}
                onRemove={() => removePhoto(index)}
              />
            ))}
          </div>
          <p className={styles.uploadStatus} aria-live="polite">
            {isPreparingPhoto
              ? "Preparing your photo..."
              : isPreparingPick
                ? pipelineStatusCopy || "Preparing your photos..."
                : `${readyCount}/3 dating pics ready`}
          </p>
        </section>
      );
    }

    if (activeStep === "winner") {
      return (
        <section
          className={`${styles.stepPanel} ${styles.winnerStep}`}
          aria-labelledby="winner-title"
        >
          <div className={styles.stepCopyBlock}>
            <span className={styles.stepKicker}>
              {richPhotoPick?.setQuality === "weak"
                ? "The honest pick"
                : "Your winner"}
            </span>
            <h2 id="winner-title" className={styles.stepTitle}>
              {richPhotoPick?.headline ?? "Put this one first."}
            </h2>
          </div>

          {winningPhoto && photoPick ? (
            <div className={styles.winnerCard}>
              <div className={styles.winnerPhoto}>
                {/* Object URLs are local browser previews and bypass image optimization. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={winningPhoto.previewUrl}
                  alt={`Chosen dating profile photo ${photoPick.winnerIndex + 1}`}
                />
                <span>Photo {photoPick.winnerIndex + 1}</span>
              </div>
              <div className={styles.winnerCopy}>
                <span>
                  {richPhotoPick?.setQuality === "weak"
                    ? "The honest take"
                    : "Why this one"}
                </span>
                {richPhotoPick?.strength ? (
                  <p className={styles.winnerStrength}>
                    {richPhotoPick.strength}
                  </p>
                ) : null}
                <p className={styles.winnerDiagnosis}>
                  {richPhotoPick?.diagnosis ?? photoPick.reason}
                </p>
              </div>
            </div>
          ) : null}
        </section>
      );
    }

    if (activeStep === "range") {
      return (
        <section
          className={`${styles.stepPanel} ${styles.scoreStep}`}
          aria-labelledby="score-title"
        >
          <div className={styles.stepCopyBlock}>
            <span className={styles.stepKicker}>Best of your three.</span>
            <h2
              id="score-title"
              className={`${styles.stepTitle} ${styles.scoreStepTitle}`}
            >
              Now get its real-world swipe score.
            </h2>
            <p className={styles.stepText}>
              {richPhotoPick?.bridge ??
                "Winning this set only makes it your best option. See how 20 real women in your dating range score it."}
            </p>
          </div>

          <div
            className={styles.scoreMeter}
            role="img"
            aria-label="Your 20-woman photo score is locked"
          >
            <div className={styles.scoreBlurredDigits} aria-hidden="true">
              <i />
              <i className={styles.scoreBlurDot} />
              <i />
            </div>
            <span>/10</span>
            <b>Score locked</b>
          </div>

          <div className={styles.rangeBlock}>
            <div className={styles.rangeHeading}>
              <strong>Who should score it?</strong>
              <span>Choose the women you actually want to match with.</span>
            </div>
            <div
              className={styles.ageGrid}
              role="group"
              aria-label="Preferred voter age range"
            >
              {voterAgeRanges.map((range) => {
                const selected = range.value === voterAgeRange;
                return (
                  <button
                    key={range.value}
                    type="button"
                    aria-label={`Women age ${range.label}`}
                    aria-pressed={selected}
                    className={`${styles.ageChip} ${selected ? styles.ageChipSelected : ""}`}
                    onClick={() => chooseAgeRange(range.value)}
                  >
                    <strong>{range.label}</strong>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      );
    }

    return null;
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar} aria-label="Picmaxx photo test">
        <div className={styles.brand} aria-label="Picmaxx">
          <span className={styles.brandMark}>picmaxx</span>
          <span className={styles.brandDot} aria-hidden="true" />
        </div>
      </header>

      <div className={styles.stepForm}>
        <div className={styles.stepViewport}>{renderStep()}</div>

        <div className={styles.stepActions}>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}

          <div className={styles.stepButtonRow}>
            {!isFirstStep ? (
              <button
                key="back"
                className={`${styles.navButton} ${styles.navButtonSecondary}`}
                type="button"
                disabled={isPreparingPhoto || isPreparingPick || isSubmitting}
                onClick={goBack}
              >
                Back
              </button>
            ) : null}

            {isFinalStep ? (
              <button
                key="checkout"
                className={styles.checkoutButton}
                type="button"
                disabled={isSubmitting}
                aria-busy={isSubmitting}
                onClick={startCheckout}
              >
                <span className={styles.checkoutButtonText}>
                  {isSubmitting ? <span className={styles.buttonSpinner} aria-hidden="true" /> : null}
                  <span>Unlock my swipe score</span>
                </span>
                <strong>$9</strong>
              </button>
            ) : (
              <button
                key={`next-${activeStep}`}
                className={styles.navButton}
                type="button"
                disabled={
                  isPreparingPhoto || isPreparingPick || uploadCtaDisabled
                }
                aria-busy={
                  activeStep === "upload" &&
                  (isPreparingPhoto || isPreparingPick)
                }
                onClick={goNext}
              >
                <span className={styles.navButtonText}>
                  {activeStep === "upload" &&
                  (isPreparingPhoto || isPreparingPick) ? (
                    <span className={styles.buttonSpinner} aria-hidden="true" />
                  ) : null}
                  <span>
                    {activeStep === "upload" &&
                    (isPreparingPhoto || isPreparingPick)
                      ? isPreparingPhoto
                        ? "Preparing photo..."
                        : pipelineStatusCopy || "Preparing your photos..."
                      : nextLabelByStep[activeStep]}
                  </span>
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function PhotoSlot({
  index,
  photo,
  disabled,
  onClick,
  onChange,
  onRemove,
}: {
  index: number;
  photo: SelectedPhoto | null;
  disabled: boolean;
  onClick: () => void;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  const inputId = `ad-photo-${index}`;

  return (
    <div
      className={`${styles.photoSlot} ${photo ? styles.photoSlotFilled : ""} ${
        disabled ? styles.photoSlotDisabled : ""
      }`}
    >
      <input
        id={inputId}
        type="file"
        disabled={disabled}
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
        onChange={onChange}
      />
      {photo ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.previewUrl} alt={`Preview of photo ${index + 1}`} />
          <div className={styles.photoMeta}>
            <span>Photo {index + 1}</span>
            <strong>{photo.displayName}</strong>
          </div>
          <button type="button" disabled={disabled} onClick={onRemove}>
            Replace
          </button>
        </>
      ) : (
        <label
          htmlFor={inputId}
          aria-disabled={disabled}
          onClick={disabled ? undefined : onClick}
        >
          <span>+</span>
          <strong>Photo {index + 1}</strong>
          <em>tap to add</em>
        </label>
      )}
    </div>
  );
}
