"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useMemo, useState } from "react";

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
import styles from "./test.module.css";

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

const packageIds: PhotoTestPackageId[] = ["best_of_three", "single"];

function getCookie(name: string) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

async function parseError(response: Response) {
  const data = await response.json().catch(() => null);
  return data?.error ?? "Something went wrong. Try again.";
}

export default function PhotoTestPage() {
  const [packageId, setPackageId] = useState<PhotoTestPackageId>("best_of_three");
  const [voterAgeRange, setVoterAgeRange] = useState<VoterAgeRange>("25-34");
  const [email, setEmail] = useState("");
  const [photos, setPhotos] = useState<(SelectedPhoto | null)[]>([null, null, null]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedPackage = photoTestPackages[packageId];
  const maxPhotos = selectedPackage.maxPhotoCount;
  const visiblePhotos = photos.slice(0, maxPhotos);
  const readyCount = visiblePhotos.filter(Boolean).length;
  const selectedAgeRange =
    voterAgeRanges.find((range) => range.value === voterAgeRange) ?? voterAgeRanges[1];

  const ctaLabel = useMemo(() => {
    if (isSubmitting) return status || "Preparing checkout";
    if (packageId === "single") return "Get my score";
    return "Find my best photo";
  }, [isSubmitting, packageId, status]);

  function choosePackage(nextPackageId: PhotoTestPackageId) {
    setPackageId(nextPackageId);
    const nextMaxPhotos = photoTestPackages[nextPackageId].maxPhotoCount;
    setPhotos((current) => {
      const next = [...current];
      for (let index = nextMaxPhotos; index < next.length; index += 1) {
        const photo = next[index];
        if (photo) {
          URL.revokeObjectURL(photo.previewUrl);
          next[index] = null;
        }
      }
      return next;
    });
    setError("");
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

  function validateForm() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return "Enter the email where you want results sent.";
    }
    if (!isValidPhotoCount(packageId, readyCount)) {
      return `Add ${photoCountLabel(packageId)}.`;
    }
    return "";
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    const finalPhotos = visiblePhotos.filter((photo): photo is SelectedPhoto => Boolean(photo));
    setError("");
    setIsSubmitting(true);

    try {
      setStatus("Creating test");
      const initResponse = await fetch("/api/photo-tests/init", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          packageId,
          email,
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
        }),
      });

      if (!initResponse.ok) throw new Error(await parseError(initResponse));
      const initData = (await initResponse.json()) as UploadResponse;

      setStatus("Uploading photos");
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

      setStatus("Opening checkout");
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
          content_type: packageId,
        },
        { eventID: checkout.initiateCheckoutEventId },
      );
      window.location.href = checkout.checkoutUrl;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
      setStatus("");
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/">
          <span className={styles.brandMark}>picmaxx</span>
          <span className={styles.brandDot} aria-hidden="true" />
        </Link>
        <span className={styles.pricePill}>24h</span>
      </header>

      <form className={styles.flow} onSubmit={submit}>
        <section className={styles.hero} aria-labelledby="test-title">
          <p className={styles.eyebrow}>24h private photo test</p>
          <h1 id="test-title" className={styles.title}>
            Know which pic to use.
          </h1>
          <p className={styles.subcopy}>
            Upload your dating photos. Real women vote privately. We email the answer within 24 hours.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="package-title">
          <div className={styles.sectionHead}>
            <span>01</span>
            <h2 id="package-title">Pick your test</h2>
          </div>
          <div className={styles.packageGrid}>
            {packageIds.map((id) => {
              const item = photoTestPackages[id];
              const selected = id === packageId;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={selected}
                  className={`${styles.packageCard} ${selected ? styles.packageCardSelected : ""}`}
                  onClick={() => choosePackage(id)}
                >
                  <span className={styles.packageEyebrow}>{item.eyebrow}</span>
                  <strong>{item.title}</strong>
                  <span>{item.promise}</span>
                </button>
              );
            })}
          </div>
          <p className={styles.helper}>{selectedPackage.helper}</p>
        </section>

        <section className={styles.section} aria-labelledby="age-title">
          <div className={styles.sectionHead}>
            <span>02</span>
            <h2 id="age-title">What is your dating range?</h2>
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
                  onClick={() => setVoterAgeRange(range.value)}
                >
                  <strong>{range.label}</strong>
                  <span>{range.helper}</span>
                </button>
              );
            })}
          </div>
          <p className={styles.helper}>
            Pick the age range you actually want feedback from.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="upload-title">
          <div className={styles.sectionHead}>
            <span>03</span>
            <h2 id="upload-title">Add photos</h2>
          </div>
          <div className={styles.uploadGrid}>
            {Array.from({ length: maxPhotos }).map((_, index) => (
              <PhotoSlot
                key={`${packageId}-${index}`}
                index={index}
                photo={photos[index]}
                onChange={(event) => replacePhoto(index, event)}
                onRemove={() => removePhoto(index)}
              />
            ))}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="email-title">
          <div className={styles.sectionHead}>
            <span>04</span>
            <h2 id="email-title">Where should results go?</h2>
          </div>
          <input
            className={styles.emailInput}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="email for results"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </section>

        <div className={styles.summary}>
          <span>
            {readyCount}/{maxPhotos} photos ready · voters {selectedAgeRange.label}
          </span>
          <strong>{selectedPackage.resultCopy}</strong>
        </div>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <div className={styles.stickyCta}>
          <button className={styles.checkoutButton} type="submit" disabled={isSubmitting}>
            <span>{ctaLabel}</span>
            <strong>$9</strong>
          </button>
          <p>Secure checkout by Stripe. Photos stay private.</p>
        </div>
      </form>
    </main>
  );
}

function PhotoSlot({
  index,
  photo,
  onChange,
  onRemove,
}: {
  index: number;
  photo: SelectedPhoto | null;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  const inputId = `photo-${index}`;

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
            <span>Photo {index + 1}</span>
            <strong>{photo.file.name}</strong>
          </div>
          <button type="button" onClick={onRemove}>
            Replace
          </button>
        </>
      ) : (
        <label htmlFor={inputId}>
          <span>+</span>
          <strong>Photo {index + 1}</strong>
          <em>tap to upload</em>
        </label>
      )}
    </div>
  );
}
