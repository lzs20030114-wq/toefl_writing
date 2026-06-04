"use client";
import { useState, useEffect } from "react";
import { getSavedCode, getSavedTier } from "./AuthContext";
import { checkCanPractice, FREE_DAILY_LIMIT } from "./dailyUsage";

/**
 * Hook for usage-gated practice.
 * Returns { canPractice, remaining, limit, showLimit, setShowLimit, onScoreComplete, loading }
 *
 * Usage:
 *   const usage = useUsageGate();
 *   // Before starting: if (!usage.canPractice) { usage.setShowLimit(true); return; }
 *   // After scoring: await usage.onScoreComplete();
 */
export function useUsageGate() {
  const [canPractice, setCanPractice] = useState(true);
  const [remaining, setRemaining] = useState(FREE_DAILY_LIMIT);
  const [limit, setLimit] = useState(FREE_DAILY_LIMIT);
  const [showLimit, setShowLimit] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const code = getSavedCode();
    const tier = getSavedTier();

    if (!code) {
      setCanPractice(true);
      setRemaining(-1);
      setLimit(-1);
      setLoading(false);
      return;
    }

    // Always check server — catches expired pro
    checkCanPractice(code, tier).then(({ allowed, remaining: r, limit: l }) => {
      setCanPractice(allowed);
      setRemaining(r);
      setLimit(l);
      setLoading(false);
    });
  }, []);

  // The credit is consumed server-side by /api/ai at scoring time. After a
  // score completes, just re-read the authoritative remaining count from the
  // server to refresh the displayed quota (no client-side consume).
  async function onScoreComplete() {
    const code = getSavedCode();
    if (!code) return;

    const { allowed, remaining: r } = await checkCanPractice(code, getSavedTier());
    if (r !== -1) {
      setRemaining(r);
      setCanPractice(allowed);
    }
  }

  return { canPractice, remaining, limit, showLimit, setShowLimit, onScoreComplete, loading };
}
