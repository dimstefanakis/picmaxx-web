"use client";

import Image from "next/image";
import {
  type CSSProperties,
  ChangeEvent,
  type MouseEvent,
  type PointerEvent,
  useState,
} from "react";
import posthog from "posthog-js";

import {
  PhotoTestPackageId,
  VoterAgeRange,
  inferImageType,
  isValidPhotoCount,
  photoCountLabel,
  photoTestPackages,
  validatePhotoMeta,
  voterAgeRanges,
} from "@/lib/photo-test";
import styles from "./photo-test.module.css";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

type SelectedPhoto = {
  file: File;
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

type StepId = "intro" | "how" | "upload" | "range";

const returnPath = "/photo-test";
const adPackageId: PhotoTestPackageId = "single";
const stepOrder: StepId[] = ["intro", "how", "upload", "range"];
const nextLabelByStep: Record<StepId, string> = {
  intro: "Start photo test",
  how: "Next",
  upload: "Next",
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

export default function PhotoTestAdPage() {
  const [activeStep, setActiveStep] = useState<StepId>("intro");
  const [voterAgeRange, setVoterAgeRange] = useState<VoterAgeRange>("25-34");
  const [photos, setPhotos] = useState<(SelectedPhoto | null)[]>([null]);
  const [comparisonSplit, setComparisonSplit] = useState(58);
  const [isDraggingComparison, setIsDraggingComparison] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedPackage = photoTestPackages[adPackageId];
  const maxPhotos = selectedPackage.maxPhotoCount;
  const visiblePhotos = photos.slice(0, maxPhotos);
  const readyCount = visiblePhotos.filter(Boolean).length;
  const comparisonStyle = {
    "--split": `${comparisonSplit}%`,
  } as CSSProperties;

  const activeStepIndex = stepOrder.indexOf(activeStep);
  const isFirstStep = activeStepIndex === 0;
  const isFinalStep = activeStep === "range";

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

  function replacePhoto(index: number, event: ChangeEvent<HTMLInputElement>) {
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
      return;
    }

    setError("");
    posthog.capture("photo_upload_added", {
      photo_index: index,
      package_id: adPackageId,
      variant: "ad",
    });
    setPhotos((current) => {
      const next = [...current];
      const previous = next[index];
      if (previous) URL.revokeObjectURL(previous.previewUrl);
      next[index] = {
        file,
        previewUrl: URL.createObjectURL(file),
      };
      return next;
    });
  }

  function removePhoto(index: number) {
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
    if (isFirstStep) return;
    setError("");
    setActiveStep(stepOrder[activeStepIndex - 1]);
  }

  function goNext(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (activeStep === "upload" && !isValidPhotoCount(adPackageId, readyCount)) {
      setError(`Add ${photoCountLabel(adPackageId)}.`);
      return;
    }

    const nextStep = stepOrder[activeStepIndex + 1];
    if (!nextStep) return;
    setError("");
    setActiveStep(nextStep);
  }

  function validateForm() {
    if (!isValidPhotoCount(adPackageId, readyCount)) {
      return `Add ${photoCountLabel(adPackageId)}.`;
    }
    return "";
  }

  async function startCheckout() {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    const finalPhotos = visiblePhotos.filter((photo): photo is SelectedPhoto => Boolean(photo));
    setError("");
    setIsSubmitting(true);

    try {
      const initResponse = await fetch("/api/photo-tests/init", {
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
          voterAgeRange,
          sourceUrl: window.location.href,
          referrer: document.referrer,
          fbp: getCookie("_fbp"),
          fbc: getCookie("_fbc"),
          returnPath,
        }),
      });

      if (!initResponse.ok) throw new Error(await parseError(initResponse));
      const initData = (await initResponse.json()) as UploadResponse;

      await Promise.all(
        finalPhotos.map(({ file }, index) =>
          fetch(initData.uploads[index].uploadUrl, {
            method: "PUT",
            headers: initData.uploads[index].headers,
            body: file,
          }).then((response) => {
            if (!response.ok) throw new Error("Photo upload failed. Try again.");
          }),
        ),
      );

      const checkoutResponse = await fetch("/api/photo-tests/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orderToken: initData.orderToken }),
      });

      if (!checkoutResponse.ok) throw new Error(await parseError(checkoutResponse));
      const checkout = (await checkoutResponse.json()) as {
        ok: true;
        checkoutUrl: string;
        initiateCheckoutEventId: string;
      };

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
      posthog.capture("checkout_initiated", {
        package_id: adPackageId,
        voter_age_range: voterAgeRange,
        photo_count: finalPhotos.length,
        order_id: initData.orderId,
        variant: "ad",
      });
      window.location.href = checkout.checkoutUrl;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
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
              Find the photo that gets{" "}
              <span className={styles.titleAccent}>5x more matches</span> on Tinder.
            </h1>
            <p className={styles.subcopy}>
              <strong>Most guys pick the photo they like.</strong> Women pick the
              one they would swipe on. <strong>Test yours before you waste more matches.</strong>
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
            <span>The fact</span>
            <strong id="fact-title">
              You cannot swipe on <em>yourself.</em>
            </strong>
            <p>
              <strong>Keeping the same pic feels easy, but it is still a guess.</strong>{" "}
              A quick test tells you if it works, what hurts, and what to lead with next.
            </p>
          </div>
          <h3 className={styles.fixTitle}>The fix</h3>
          <div className={styles.stepCards}>
            <div className={styles.contextItem}>
              <span>01</span>
              <strong>Send the pic you use now</strong>
              <p>Use the photo sitting first on Tinder, Hinge, or Bumble right now.</p>
            </div>
            <div className={styles.contextItem}>
              <span>02</span>
              <strong>Women rank the swipe</strong>
              <p>They judge it like a swipe, not like a photoshoot.</p>
            </div>
            <div className={styles.contextItem}>
              <span>03</span>
              <strong>Lead with the winner</strong>
              <p>Get the score, notes, and AI edit built from what they said.</p>
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
              Add your lead photo.
            </h2>
            <p className={styles.stepText}>Use the photo that shows first today.</p>
          </div>
          <div className={styles.uploadGrid}>
            {Array.from({ length: maxPhotos }).map((_, index) => (
              <PhotoSlot
                key={`lead-${index}`}
                index={index}
                photo={photos[index]}
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
        </section>
      );
    }

    if (activeStep === "range") {
      return (
        <section className={styles.stepPanel} aria-labelledby="age-title">
          <div className={styles.stepCopyBlock}>
            <h2 id="age-title" className={styles.stepTitle}>
              Who should judge it?
            </h2>
            <p className={styles.stepText}>Pick the women whose swipe you care about.</p>
          </div>
          <div className={styles.ageGrid} role="group" aria-label="Preferred voter age range">
            {voterAgeRanges.map((range) => {
              const selected = range.value === voterAgeRange;
              return (
                <button
                  key={range.value}
                  type="button"
                  aria-pressed={selected}
                  className={`${styles.ageChip} ${selected ? styles.ageChipSelected : ""}`}
                  onClick={() => chooseAgeRange(range.value)}
                >
                  <strong>{range.label}</strong>
                  <span>{range.helper}</span>
                </button>
              );
            })}
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
                  <span>Get my rating</span>
                </span>
                <strong>$9</strong>
              </button>
            ) : (
              <button
                key={`next-${activeStep}`}
                className={styles.navButton}
                type="button"
                onClick={goNext}
              >
                {nextLabelByStep[activeStep]}
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
  onClick,
  onChange,
  onRemove,
}: {
  index: number;
  photo: SelectedPhoto | null;
  onClick: () => void;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  const inputId = `ad-photo-${index}`;

  return (
    <div className={`${styles.photoSlot} ${photo ? styles.photoSlotFilled : ""}`}>
      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
        onChange={onChange}
      />
      {photo ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.previewUrl} alt="" />
          <div className={styles.photoMeta}>
            <span>Lead photo</span>
            <strong>{photo.file.name}</strong>
          </div>
          <button type="button" onClick={onRemove}>
            Replace
          </button>
        </>
      ) : (
        <label htmlFor={inputId} onClick={onClick}>
          <span>+</span>
          <strong>Lead photo</strong>
          <em>tap to upload your opener</em>
        </label>
      )}
    </div>
  );
}
