"use client";

import Image from "next/image";
import Script from "next/script";
import { FormEvent, useState } from "react";
import styles from "./page.module.css";

const demoPhotos = [
  { src: "/demo-photos/submitter-1.jpg", alt: "", width: 1200, height: 1800 },
  { src: "/demo-photos/feed-2.jpg", alt: "", width: 1200, height: 800 },
  { src: "/demo-photos/feed-3.jpg", alt: "", width: 1200, height: 1800 },
  { src: "/demo-photos/submitter-4.jpg", alt: "", width: 1200, height: 800 },
];

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

        <div className={styles.visual} aria-hidden="true">
          <div className={styles.photoStrip}>
            {demoPhotos.map((photo) => (
              <Image
                key={photo.src}
                className={styles.photoImage}
                src={photo.src}
                alt={photo.alt}
                width={photo.width}
                height={photo.height}
                sizes="(max-width: 720px) 25vw, 120px"
              />
            ))}
          </div>

          <div className={`${styles.tag} ${styles.tagOne}`}>
            5x more matches
          </div>
          <div className={`${styles.tag} ${styles.tagTwo}`}>
            rated by women
          </div>

          <div className={styles.phone}>
            <div className={styles.screen}>
              <Image
                className={styles.screenImage}
                src="/demo-photos/submitter-2.jpg"
                alt=""
                width={1200}
                height={2133}
                priority
                sizes="268px"
              />
              <div className={styles.screenContent}>
                <div className={styles.votePill}>
                  <span>photo 03</span>
                  <span>keep</span>
                </div>
                <div className={styles.score}>
                  <strong>9.1</strong>
                  <span>top profile photo</span>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.ticker}>
            <div className={styles.tickerTrack}>
              <span>get 5x more matches</span>
              <span>real ratings</span>
              <span>better first photo</span>
              <span>paid reviewers</span>
              <span>get 5x more matches</span>
              <span>real ratings</span>
              <span>better first photo</span>
              <span>paid reviewers</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
