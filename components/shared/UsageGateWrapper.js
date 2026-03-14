"use client";
import { useUsageGate } from "../../lib/useUsageGate";
import UsageLimitModal from "./UsageLimitModal";

/**
 * Wraps a practice task component with daily usage checking.
 * Shows a limit modal if the user has no remaining free sessions.
 * Legacy/Pro users pass through immediately.
 */
export default function UsageGateWrapper({ children, onExit }) {
  const { canPractice, limit, showLimit, setShowLimit, onScoreComplete, loading } = useUsageGate();

  if (loading) return null; // brief flash while checking

  if (!canPractice && !showLimit) {
    // Show limit modal immediately
    return <UsageLimitModal limit={limit} onClose={onExit} />;
  }

  if (showLimit) {
    return <UsageLimitModal limit={limit} onClose={onExit} />;
  }

  // Pass onScoreComplete to children if they support it
  return typeof children === "function" ? children({ onScoreComplete }) : children;
}
