"use client";

import Image from "next/image";
import Script from "next/script";
import { CSSProperties, FormEvent, useState } from "react";
import styles from "./page.module.css";

const comparisonPhotos = {
  before: {
    src: "/demo-photos/picmaxx-before.webp",
    matches: "8 matches",
    label: "before",
  },
  after: {
    src: "/demo-photos/picmaxx-after.webp",
    matches: "41 matches",
    label: "after PicMaxx",
  },
};

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

const META_PIXEL_ID = "1532157435278333";

function getCookie(name: string) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

export default function Home() {
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [comparisonSplit, setComparisonSplit] = useState(64);
  const comparisonStyle = {
    "--split": `${comparisonSplit}%`,
  } as CSSProperties;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();

    if (!email) return;

    const eventId =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `lead-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    setIsSubmitting(true);
    setStatus("");

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          audience: "male",
          eventId,
          sourceUrl: window.location.href,
          referrer: document.referrer,
          fbp: getCookie("_fbp"),
          fbc: getCookie("_fbc"),
        }),
      });

      if (!response.ok) {
        throw new Error("Waitlist request failed");
      }

      window.fbq?.("track", "Lead", {}, { eventID: eventId });
      setStatus("You're on the waitlist.");
      form.reset();
    } catch {
      setStatus("Something went wrong. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className={styles.page}>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '${META_PIXEL_ID}');
          fbq('track', 'PageView');
        `}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>
      <header className={styles.topbar} aria-label="PicMaxx">
        <a className={styles.brand} href="#" aria-label="PicMaxx home">
          <span className={styles.brandMark}>picmaxx</span>
          <span className={styles.brandDot} aria-hidden="true" />
        </a>
      </header>

      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.copy}>
          <div>
            <h1 id="hero-title" className={styles.title}>
              Get 5x
              <br />
              more
              <br />
              matches
            </h1>
          </div>

          <div className={styles.promiseRow}>
            <p className={styles.promise}>
              Find the photos that put you in the <em>top 10%</em>. Ranked by
              real women before you swipe.
            </p>

            <form className={styles.waitlist} onSubmit={onSubmit}>
              <div className={styles.emailLine}>
                <input
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="email for early access"
                  required
                />
                <button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "joining" : "join"}
                </button>
              </div>
              <p
                className={styles.status}
                role="status"
                aria-live="polite"
              >
                {status}
              </p>
            </form>
          </div>
        </div>

        <div className={styles.visual}>
          <div className={styles.comparisonShell}>
            <div className={styles.comparisonFrame} style={comparisonStyle}>
              <div className={`${styles.comparisonLayer} ${styles.beforeLayer}`}>
                <Image
                  className={styles.comparisonImage}
                  src={comparisonPhotos.before.src}
                  alt="Before PicMaxx profile photo"
                  fill
                  priority
                  sizes="(max-width: 720px) 86vw, (max-width: 1080px) 440px, 36vw"
                />
                <div className={`${styles.matchBadge} ${styles.beforeBadge}`}>
                  <span>{comparisonPhotos.before.label}</span>
                  <strong>{comparisonPhotos.before.matches}</strong>
                </div>
              </div>

              <div className={`${styles.comparisonLayer} ${styles.afterLayer}`}>
                <Image
                  className={styles.comparisonImage}
                  src={comparisonPhotos.after.src}
                  alt="After PicMaxx profile photo"
                  fill
                  priority
                  sizes="(max-width: 720px) 86vw, (max-width: 1080px) 440px, 36vw"
                />
                <div className={`${styles.matchBadge} ${styles.afterBadge}`}>
                  <span>{comparisonPhotos.after.label}</span>
                  <strong>{comparisonPhotos.after.matches}</strong>
                </div>
              </div>

              <input
                className={styles.sliderInput}
                type="range"
                min="18"
                max="82"
                value={comparisonSplit}
                onChange={(event) =>
                  setComparisonSplit(Number(event.currentTarget.value))
                }
                aria-label="Reveal the before and after photo comparison"
              />

              <div className={styles.sliderRail}>
                <div className={styles.sliderHandle}>
                  <span />
                  <span />
                </div>
              </div>
            </div>

            <div className={styles.liftBadge}>
              <span>5.1x lift</span>
              <strong>photo order fixed</strong>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
