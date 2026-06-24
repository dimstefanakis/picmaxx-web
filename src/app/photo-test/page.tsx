"use client";

import Image from "next/image";
import { ChangeEvent, FormEvent, useMemo, useState } from "react";
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

const packageIds: PhotoTestPackageId[] = ["best_of_three", "single"];
const returnPath = "/photo-test";

function getCookie(name: string) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

async function parseError(response: Response) {
  const data = await response.json().catch(() => null);
  return data?.error ?? "Something went wrong. Try again.";
}

export default function PhotoTestAdPage() {
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
    posthog.capture("package_selected", {
      package_id: nextPackageId,
      max_photos: photoTestPackages[nextPackageId].maxPhotoCount,
      variant: "ad",
    });
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
    posthog.capture("photo_upload_added", {
      photo_index: index,
      package_id: packageId,
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
          returnPath,
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
      posthog.identify(email, { email });
      posthog.capture("checkout_initiated", {
        package_id: packageId,
        voter_age_range: voterAgeRange,
        photo_count: finalPhotos.length,
        order_id: initData.orderId,
        variant: "ad",
      });
      window.location.href = checkout.checkoutUrl;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
      setStatus("");
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar} aria-label="Picmaxx photo test">
        <div className={styles.brand} aria-label="Picmaxx">
          <span className={styles.brandMark}>picmaxx</span>
          <span className={styles.brandDot} aria-hidden="true" />
        </div>
        <span className={styles.topPill}>5x photo test</span>
      </header>

      <section className={styles.hero} aria-labelledby="photo-test-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>For guys on Tinder, Hinge, and Bumble</p>
          <h1 id="photo-test-title" className={styles.title}>
            Find the photo that gets 5x more matches.
          </h1>
          <p className={styles.subcopy}>
            There is probably a shot in your gallery that performs way better than
            the rest. Upload 2-3 contenders and women in your dating range pick the
            one most likely to make the algorithm notice.
          </p>
        </div>

        <div className={styles.phonePreview} aria-label="Example result preview">
          <div className={styles.previewBar}>
            <span>sample report</span>
            <strong>score + rank</strong>
          </div>
          <div className={styles.previewGrid}>
            <div className={styles.previewWinner}>
              <Image
                src="/demo-photos/ad-formal-profile.jpeg"
                alt="Example first ranked dating photo"
                fill
                priority
                sizes="(max-width: 720px) 54vw, 280px"
              />
              <span>winner</span>
              <strong className={styles.previewScore}>8.8/10</strong>
            </div>
            <div className={styles.previewStack}>
              <div>
                <Image
                  src="/demo-photos/picmaxx-after.webp"
                  alt="Example second ranked dating photo"
                  fill
                  sizes="(max-width: 720px) 26vw, 120px"
                />
                <span>#2</span>
                <strong className={styles.previewScore}>7.4/10</strong>
              </div>
              <div>
                <Image
                  src="/demo-photos/picmaxx-before.webp"
                  alt="Example third ranked dating photo"
                  fill
                  sizes="(max-width: 720px) 26vw, 120px"
                />
                <span>#3</span>
                <strong className={styles.previewScore}>6.1/10</strong>
              </div>
            </div>
          </div>
          <p className={styles.previewNote}>
            Result: lead with the photo that creates the strongest first impression.
            Score shows the swipe signal behind each shot.
          </p>
        </div>
      </section>

      <section className={styles.contextBand} aria-label="How Picmaxx works">
        <div className={styles.contextItem}>
          <span>01</span>
          <strong>Drop your contenders</strong>
          <p>Choose the photos you think might work on Hinge, Tinder, or Bumble.</p>
        </div>
        <div className={styles.contextItem}>
          <span>02</span>
          <strong>Women vote privately</strong>
          <p>Reviewers pick the one they would be most likely to swipe on.</p>
        </div>
        <div className={styles.contextItem}>
          <span>03</span>
          <strong>Lead with the winner</strong>
          <p>Put the strongest photo first and stop wasting matches on the wrong opener.</p>
        </div>
      </section>

      <section className={styles.signalPanel} aria-label="Why the first photo matters">
        <span>Why 5x happens</span>
        <strong>Dating app results compound off the first photo.</strong>
        <p>
          A better lead photo can earn more pauses, likes, and replies. Those signals
          can push your profile further, which is why the gap between a good pic and
          a great one can feel exponential.
        </p>
      </section>

      <form className={styles.flow} onSubmit={submit}>
        <section className={styles.formIntro} aria-labelledby="checkout-title">
          <p className={styles.eyebrow}>Upload photos</p>
          <h2 id="checkout-title">Start here.</h2>
          <p>
            Choose a package, add photos, then checkout securely.
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
            <h2 id="age-title">Dating range</h2>
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
          <p className={styles.helper}>Choose who should judge the first impression.</p>
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
            <h2 id="email-title">Results email</h2>
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
            {readyCount}/{maxPhotos} photos ready - voters {selectedAgeRange.label}
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
          <p>Secure checkout by Stripe.</p>
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
