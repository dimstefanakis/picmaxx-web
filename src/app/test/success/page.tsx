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
  purchaseEventUuid: string;
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
    let pixelRetryTimeout: number | undefined;
    let purchaseStatusTimeout: number | undefined;
    const maxPurchaseStatusAttempts = 6;

    async function verifyAndTrackPurchase(attempt = 1) {
      try {
        const response = await fetch("/api/photo-tests/purchase-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, sessionId }),
        });
        if (!response.ok) throw new Error("Purchase status unavailable");

        const purchase = (await response.json()) as
          | PaidPurchase
          | { ok: true; paid: false };
        if (cancelled) return;
        if (!purchase.paid) {
          if (attempt < maxPurchaseStatusAttempts) {
            purchaseStatusTimeout = window.setTimeout(
              () => void verifyAndTrackPurchase(attempt + 1),
              750,
            );
          }
          return;
        }
        const paidPurchase: PaidPurchase = purchase;

        const posthogStorageKey = `picmaxx_posthog_purchase_${paidPurchase.eventId}`;
        if (!window.sessionStorage.getItem(posthogStorageKey)) {
          posthog.capture(
            "purchase_completed",
            {
              $insert_id: `photo-test-purchase-${sessionId}`,
              order_id: paidPurchase.eventId,
              stripe_session_id: sessionId,
              package_id: paidPurchase.packageId,
              amount_cents: paidPurchase.amountCents,
              value: paidPurchase.amountCents / 100,
              currency: paidPurchase.currency.toUpperCase(),
              source: "success_page",
            },
            {
              uuid: paidPurchase.purchaseEventUuid,
              send_instantly: true,
            },
          );
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
            pixelRetryTimeout = window.setTimeout(trackPurchase, 250);
          }
        }

        trackPurchase();
      } catch (error) {
        if (cancelled) return;
        if (attempt < maxPurchaseStatusAttempts) {
          purchaseStatusTimeout = window.setTimeout(
            () => void verifyAndTrackPurchase(attempt + 1),
            750,
          );
          return;
        }
        posthog.capture("purchase_status_check_failed", {
          order_id: orderId,
          stripe_session_id: sessionId,
          attempts: attempt,
          error_message:
            error instanceof Error ? error.message : "Purchase status unavailable",
        });
      }
    }

    void verifyAndTrackPurchase();
    return () => {
      cancelled = true;
      if (pixelRetryTimeout) window.clearTimeout(pixelRetryTimeout);
      if (purchaseStatusTimeout) window.clearTimeout(purchaseStatusTimeout);
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
          <h1 className={styles.title}>Your test is live.</h1>
          <p className={styles.subcopy}>
            Your score and private feedback arrive by email within 24 hours.
          </p>
        </div>
        <div className={styles.summary}>
          <span>What happens now</span>
          <strong>Real women review your photo privately. You get the result by email.</strong>
        </div>
        <Link className={styles.checkoutButton} href="/">
          <span>Back to Picmaxx</span>
          <strong>ok</strong>
        </Link>
      </section>
    </main>
  );
}
