"use client";
import { useEffect } from "react";
import { installSmoothScrollPolyfill } from "../lib/smoothScrollPolyfill";
import { restoreUserCodeFromCookie } from "../lib/AuthContext";

/**
 * Mounts in the root layout to run one-time client-side bootstrap:
 *  - installs the smoothScroll polyfill on Safari < 15.3 (no-op on modern browsers)
 *  - restores the user code from cookie if localStorage was purged (iOS Safari
 *    sometimes drops localStorage under memory pressure but keeps cookies)
 *
 * Renders nothing.
 */
export default function ClientBootstrap() {
  useEffect(() => {
    installSmoothScrollPolyfill();
    restoreUserCodeFromCookie();
  }, []);
  return null;
}
