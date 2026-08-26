"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import {
  PHOTO_TEST_CURRENCY,
  PHOTO_TEST_PRICE_CENTS,
} from "@/lib/photo-test";
import {
  createTikTokEventId,
  createTikTokViewContentProperties,
  getTikTokBrowserIdentifiers,
  isTikTokViewContentPath,
  trackTikTokEvent,
} from "@/lib/tiktok";

const MAX_PIXEL_RETRIES = 20;
const PIXEL_RETRY_DELAY_MS = 250;

export function TikTokViewContent() {
  const pathname = usePathname();
  const eventRef = useRef<{ eventId: string; pathname: string } | null>(null);

  useEffect(() => {
    if (!isTikTokViewContentPath(pathname)) {
      eventRef.current = null;
      return;
    }

    if (!eventRef.current || eventRef.current.pathname !== pathname) {
      eventRef.current = {
        eventId: createTikTokEventId("view_content"),
        pathname,
      };
    }

    const eventId = eventRef.current.eventId;
    const properties = createTikTokViewContentProperties({
      pathname,
      value: PHOTO_TEST_PRICE_CENTS / 100,
      currency: PHOTO_TEST_CURRENCY,
    });
    let cancelled = false;
    let retries = 0;
    let retryTimeout: number | undefined;

    function sendBrowserEvent() {
      if (cancelled) return;

      if (
        trackTikTokEvent({
          eventName: "ViewContent",
          eventId,
          properties,
        })
      ) {
        return;
      }

      if (retries < MAX_PIXEL_RETRIES) {
        retries += 1;
        retryTimeout = window.setTimeout(
          sendBrowserEvent,
          PIXEL_RETRY_DELAY_MS,
        );
      }
    }

    sendBrowserEvent();

    const apiTimeout = window.setTimeout(() => {
      const { ttp, ttclid } = getTikTokBrowserIdentifiers();
      fetch("/api/tiktok/view-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          eventId,
          sourceUrl: window.location.href,
          referrer: document.referrer,
          ttp,
          ttclid,
        }),
      }).catch(() => {});
    }, PIXEL_RETRY_DELAY_MS);

    return () => {
      cancelled = true;
      if (retryTimeout) window.clearTimeout(retryTimeout);
      window.clearTimeout(apiTimeout);
    };
  }, [pathname]);

  return null;
}
