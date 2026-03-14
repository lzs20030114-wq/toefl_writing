"use client";
import { useState, useEffect } from "react";
import { getSavedCode, getSavedTier } from "./AuthContext";
import { checkCanPractice, consumeUsage, FREE_DAILY_LIMIT } from "./dailyUsage";

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

    if (!code || tier === "pro" || tier === "legacy") {
      setCanPractice(true);
      setRemaining(-1); // unlimited
      setLimit(-1);
      setLoading(false);
      return;
    }

    checkCanPractice(code, tier).then(({ allowed, remaining: r, limit: l }) => {
      setCanPractice(allowed);
      setRemaining(r);
      setLimit(l);
      setLoading(false);
    });
  }, []);

  async function onScoreComplete() {
    const code = getSavedCode();
    const tier = getSavedTier();
    if (!code || tier === "pro" || tier === "legacy") return;

    const { remaining: r } = await consumeUsage(code, tier);
    setRemaining(r);
    if (r <= 0) setCanPractice(false);
  }

  return { canPractice, remaining, limit, showLimit, setShowLimit, onScoreComplete, loading };
}
