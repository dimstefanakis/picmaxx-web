"use client";

import Link from "next/link";
import { useEffect } from "react";
import posthog from "posthog-js";

import { PHOTO_TEST_CURRENCY, PHOTO_TEST_PRICE_CENTS } from "@/lib/photo-test";
import styles from "../test.module.css";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

export default function PhotoTestSuccessPage() {
  useEffect(() => {
    const orderId = new URLSearchParams(window.location.search).get("order");
    if (!orderId) return;

    const posthogStorageKey = `picmaxx_posthog_purchase_${orderId}`;
    if (!window.sessionStorage.getItem(posthogStorageKey)) {
      posthog.capture("purchase_completed", {
        order_id: orderId,
        value: PHOTO_TEST_PRICE_CENTS / 100,
        currency: PHOTO_TEST_CURRENCY.toUpperCase(),
      });
      window.sessionStorage.setItem(posthogStorageKey, "1");
    }

    const storageKey = `picmaxx_purchase_${orderId}`;
    let retries = 0;
    let cancelled = false;

    function trackPurchase() {
      if (cancelled) return;

      if (window.fbq) {
        if (!window.sessionStorage.getItem(storageKey)) {
          window.fbq(
            "track",
            "Purchase",
            {
              value: PHOTO_TEST_PRICE_CENTS / 100,
              currency: PHOTO_TEST_CURRENCY.toUpperCase(),
              content_name: "Picmaxx Paid Photo Test",
              content_type: "photo_test",
            },
            { eventID: orderId },
          );
          window.sessionStorage.setItem(storageKey, "1");
        }
        return;
      }

      if (retries < 20) {
        retries += 1;
        window.setTimeout(trackPurchase, 250);
      }
    }

    trackPurchase();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/">
          <span className={styles.brandMark}>picmaxx</span>
          <span className={styles.brandDot} aria-hidden="true" />
        </Link>
        <span className={styles.pricePill}>paid</span>
      </header>

      <section className={styles.flow}>
        <div className={styles.hero}>
          <p className={styles.eyebrow}>test live</p>
          <h1 className={styles.title}>Your photos are in.</h1>
          <p className={styles.subcopy}>
            Results arrive by email within 24 hours. We will send the winner, ranking, and the signal women gave each photo.
          </p>
        </div>
        <div className={styles.summary}>
          <span>What happens now</span>
          <strong>Real women vote privately. You get the answer by email.</strong>
        </div>
        <Link className={styles.checkoutButton} href="/">
          <span>Back to Picmaxx</span>
          <strong>ok</strong>
        </Link>
      </section>
    </main>
  );
}
