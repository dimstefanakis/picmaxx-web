"use client";

import Link from "next/link";
import { useEffect } from "react";
import posthog from "posthog-js";

import {
  createTikTokCommerceProperties,
  trackTikTokEvent,
} from "@/lib/tiktok";
import styles from "../test.module.css";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

type PaidPurchase = {
  ok: true;
  paid: true;
  eventId: string;
  packageId: string;
  contentName: string;
  amountCents: number;
  currency: string;
};

export default function PhotoTestSuccessPage() {
  useEffect(() => {
    const orderId = new URLSearchParams(window.location.search).get("order");
    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!orderId || !sessionId) return;

    let cancelled = false;
    let retryTimeout: number | undefined;

    async function verifyAndTrackPurchase() {
      try {
        const response = await fetch("/api/photo-tests/purchase-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, sessionId }),
        });
        if (!response.ok) return;

        const purchase = (await response.json()) as
          | PaidPurchase
          | { ok: true; paid: false };
        if (cancelled || !purchase.paid) return;
        const paidPurchase: PaidPurchase = purchase;

        const posthogStorageKey = `picmaxx_posthog_purchase_${paidPurchase.eventId}`;
        if (!window.sessionStorage.getItem(posthogStorageKey)) {
          posthog.capture("purchase_completed", {
            order_id: paidPurchase.eventId,
            package_id: paidPurchase.packageId,
            value: paidPurchase.amountCents / 100,
            currency: paidPurchase.currency.toUpperCase(),
          });
          window.sessionStorage.setItem(posthogStorageKey, "1");
        }

        const metaStorageKey = `picmaxx_purchase_${paidPurchase.eventId}`;
        const tiktokStorageKey = `picmaxx_tiktok_purchase_${paidPurchase.eventId}`;
        const tiktokProperties = createTikTokCommerceProperties({
          contentId: paidPurchase.packageId,
          contentName: paidPurchase.contentName,
          value: paidPurchase.amountCents / 100,
          currency: paidPurchase.currency,
        });
        let retries = 0;

        function trackPurchase() {
          if (cancelled) return;

          if (window.fbq && !window.sessionStorage.getItem(metaStorageKey)) {
            window.fbq(
              "track",
              "Purchase",
              {
                value: paidPurchase.amountCents / 100,
                currency: paidPurchase.currency.toUpperCase(),
                content_name: paidPurchase.contentName,
                content_type: paidPurchase.packageId,
              },
              { eventID: paidPurchase.eventId },
            );
            window.sessionStorage.setItem(metaStorageKey, "1");
          }

          if (
            !window.sessionStorage.getItem(tiktokStorageKey) &&
            trackTikTokEvent({
              eventName: "Purchase",
              eventId: paidPurchase.eventId,
              properties: tiktokProperties,
            })
          ) {
            window.sessionStorage.setItem(tiktokStorageKey, "1");
          }

          if (
            window.sessionStorage.getItem(metaStorageKey) &&
            window.sessionStorage.getItem(tiktokStorageKey)
          ) {
            return;
          }

          if (retries < 20) {
            retries += 1;
            retryTimeout = window.setTimeout(trackPurchase, 250);
          }
        }

        trackPurchase();
      } catch {
        // The signed Stripe webhook remains the source of truth for purchase tracking.
      }
    }

    void verifyAndTrackPurchase();
    return () => {
      cancelled = true;
      if (retryTimeout) window.clearTimeout(retryTimeout);
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
