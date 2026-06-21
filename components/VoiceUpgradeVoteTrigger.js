"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { VoiceUpgradeModal } from "./home/VoiceUpgradeModal";
import { getSavedCode } from "../lib/AuthContext";
import sample from "../data/voiceAbSample.json";

// One-shot "听力语音惊喜升级" A/B vote. Globally mounted (app/layout.js).
// Pops once on the homepage, lets the visitor A/B试听 and vote, then never
// reappears for that browser.
//
// Gating is deliberately light (this is a campaign, not the first-set survey):
//   • homepage only ("进网页就会看到") — never on task pages or /admin
//   • only when BOTH sample audio URLs are present (empty = not generated yet →
//     don't show a broken player)
//   • show-once via localStorage; works for anonymous visitors too
//
// Persistence rides on /api/survey/voice-vote → user_surveys. Logged-in users
// vote with their login code; anonymous visitors get a per-browser id so their
// vote still counts and dedups.
const SEEN_KEY = "voice-upgrade-vote-2026-06";
const ANON_ID_KEY = "voice-vote-anon-id";

function hasSample() {
  return !!(sample?.voiceA?.url && sample?.voiceB?.url);
}

function getOrCreateVoterId() {
  const code = getSavedCode();
  if (code) return code;
  try {
    let anon = localStorage.getItem(ANON_ID_KEY);
    if (!anon) {
      const rand =
        (typeof crypto !== "undefined" && crypto.randomUUID)
          ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
          : Math.random().toString(36).slice(2, 18);
      anon = `anon_${rand}`;
      localStorage.setItem(ANON_ID_KEY, anon);
    }
    return anon;
  } catch {
    return `anon_${Math.random().toString(36).slice(2, 18)}`;
  }
}

export default function VoiceUpgradeVoteTrigger() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const votedRef = useRef(false);

  useEffect(() => {
    if (pathname !== "/") return;
    if (!hasSample()) return;
    let seen = null;
    try { seen = localStorage.getItem(SEEN_KEY); } catch {}
    if (seen) return;
    // Small delay so the modal doesn't slam in during first paint.
    const t = setTimeout(() => setOpen(true), 700);
    return () => clearTimeout(t);
  }, [pathname]);

  function markSeen(value) {
    try { localStorage.setItem(SEEN_KEY, value); } catch {}
  }

  async function handleVote(choice) {
    votedRef.current = true;
    markSeen(`voted:${choice}`);
    const voterId = getOrCreateVoterId();
    try {
      await fetch("/api/survey/voice-vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userCode: voterId, choice }),
      });
    } catch {
      // best-effort; the localStorage mark already prevents a re-show
    }
  }

  async function handleDismiss() {
    setOpen(false);
    if (votedRef.current) return;     // already voted+persisted; just close
    markSeen("dismissed");
    const voterId = getOrCreateVoterId();
    try {
      await fetch("/api/survey/voice-vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userCode: voterId, dismiss: true }),
      });
    } catch {
      // best-effort
    }
  }

  return (
    <VoiceUpgradeModal
      open={open}
      sample={sample}
      onVote={handleVote}
      onDismiss={handleDismiss}
    />
  );
}
