"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Tracks page views by POSTing to /api/analytics/track on route changes.
 * Call once in a top-level layout or gate component.
 *
 * @param {string|null} userCode - current user's code (if logged in)
 */
export function usePageView(userCode) {
  const pathname = usePathname();
  const sent = useRef("");

  useEffect(() => {
    if (!pathname || pathname === sent.current) return;
    sent.current = pathname;

    // Skip admin pages from analytics
    if (pathname.startsWith("/admin")) return;

    const payload = { path: pathname, userCode: userCode || null };

    // Include document.referrer only on very first navigation
    if (typeof document !== "undefined" && document.referrer) {
      try {
        const ref = new URL(document.referrer);
        if (ref.origin !== window.location.origin) {
          payload.referrer = document.referrer;
        }
      } catch { /* ignore */ }
    }

    fetch("/api/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  }, [pathname, userCode]);
}
