"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LCRTask } from "../../components/listening/LCRTask";
import { TopicPicker } from "../../components/shared/TopicPicker";
import { getSavedTier } from "../../lib/AuthContext";
import { saveSess, loadDoneIds, addDoneIds } from "../../lib/sessionStore";
import { DONE_STORAGE_KEYS } from "../../lib/questionSelector";
import LCR_DATA from "../../data/listening/bank/lcr.json";

const LISTENING_ACCENT = { color: "#8B5CF6", soft: "#F3E8FF" };

function pickRandom(items) {
  if (!items || items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function pickRandomBatch(items, size = 10) {
  if (!items || items.length === 0) return [];
  const shuffled = [...items].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(size, shuffled.length));
}

const CONTEXT_LABELS = {
  campus_life: "Campus Life",
  academic: "Academic",
  office_hours: "Office Hours",
  social: "Social",
  dormitory: "Dormitory",
  library: "Library",
  advising: "Advising",
};

const FUNCTION_LABELS = {
  indirect_request: "Indirect Request",
  expressing_concern: "Expressing Concern",
  polite_request: "Polite Request",
  suggestion: "Suggestion",
  clarification: "Clarification",
  agreement: "Agreement",
  disagreement: "Disagreement",
  offering_help: "Offering Help",
  complaint: "Complaint",
};

function firstLine(text) {
  if (!text) return "\u2014";
  const line = text.split(/[\n.!?]/).filter(Boolean)[0]?.trim() || text;
  return line.length > 70 ? line.slice(0, 67) + "..." : line;
}

function buildLCRTopics() {
  return (LCR_DATA.items || []).map((i) => ({
    id: i.id,
    tag: CONTEXT_LABELS[i.context] || i.context,
    title: i.speaker?.length > 70 ? i.speaker.slice(0, 67) + "..." : (i.speaker || "\u2014"),
    subtitle: FUNCTION_LABELS[i.pragmatic_function] || i.pragmatic_function || "",
  }));
}

function ListeningPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const type = searchParams.get("type") || "lcr";
  const mode = searchParams.get("mode") || "standard";
  const isPractice = mode === "practice";

  const [isPro, setIsPro] = useState(false);
  useEffect(() => {
    const t = getSavedTier();
    setIsPro(t === "pro" || t === "legacy");
  }, []);

  // Practice mode: topic picker state
  const [pickedItemId, setPickedItemId] = useState(null);

  // Standard mode: random batch or single item
  const [randomItems, setRandomItems] = useState(null);
  const [sessionKey, setSessionKey] = useState(0); // force re-render on new set

  useEffect(() => {
    if (isPractice) return;
    if (type === "lcr") {
      const batch = pickRandomBatch(LCR_DATA.items, 10);
      setRandomItems(batch);
    }
  }, [type, isPractice, sessionKey]);

  const onExit = () => router.push("/?section=listening");

  // Gate: Pro only
  if (!isPro) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", background: "#F4F7F5" }}>
        <div style={{ textAlign: "center", maxWidth: 360, padding: "0 20px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Pro 专属功能</div>
          <div style={{ fontSize: 14, color: "#666", marginBottom: 20, lineHeight: 1.6 }}>
            听力模块目前处于测试阶段，仅对 Pro 用户开放。升级 Pro 即可解锁。
          </div>
          <button onClick={onExit} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer", fontSize: 14 }}>
            返回首页
          </button>
        </div>
      </div>
    );
  }

  // ── Practice mode: show TopicPicker when no item selected ──
  if (isPractice && !pickedItemId) {
    const doneKey = DONE_STORAGE_KEYS.LISTENING_LCR;
    const doneIds = loadDoneIds(doneKey);
    const items = buildLCRTopics();
    const title = "Listen & Choose a Response";
    const section = "Listening Practice | LCR";

    return (
      <TopicPicker
        title={title}
        section={section}
        description="Listen to a speaker and choose the most appropriate response. No time limit in practice mode."
        items={items}
        doneIds={doneIds}
        accent={LISTENING_ACCENT}
        onSelect={(id) => setPickedItemId(id)}
        onExit={onExit}
      />
    );
  }

  // ── Resolve active items ──
  let taskItems = null;
  let singleItem = null;

  if (type === "lcr") {
    if (isPractice && pickedItemId) {
      singleItem = LCR_DATA.items.find((i) => i.id === pickedItemId) || null;
    } else {
      taskItems = randomItems;
    }
  }

  // Loading state
  if (!isPractice && !taskItems) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", background: "#F4F7F5" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎧</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Loading questions...</div>
        </div>
      </div>
    );
  }

  // No items available
  if ((isPractice && !singleItem) || (!isPractice && taskItems && taskItems.length === 0)) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", background: "#F4F7F5" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎧</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>No questions available</div>
          <div style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>Add LCR items to the question bank first.</div>
          <button onClick={onExit} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  function saveListeningSession(subtype, itemsUsed, result) {
    const pct = result.total > 0 ? result.correct / result.total : 0;
    const band = pct >= 1 ? 6 : pct >= 0.9 ? 5.5 : pct >= 0.8 ? 5 : pct >= 0.7 ? 4.5 : pct >= 0.6 ? 4 : pct >= 0.5 ? 3.5 : pct >= 0.4 ? 3 : pct >= 0.3 ? 2.5 : 2;
    saveSess({
      type: "listening",
      mode: isPractice ? "practice" : "standard",
      correct: result.correct,
      total: result.total,
      band,
      details: {
        subtype,
        itemIds: Array.isArray(itemsUsed) ? itemsUsed.map((i) => i.id) : [itemsUsed.id],
        results: result.results,
      },
    });

    // Mark items as done
    const doneKey = DONE_STORAGE_KEYS.LISTENING_LCR;
    const doneItemIds = Array.isArray(itemsUsed) ? itemsUsed.map((i) => i.id) : [itemsUsed.id];
    addDoneIds(doneKey, doneItemIds);
  }

  const handleComplete = (result) => {
    const itemsUsed = isPractice ? singleItem : taskItems;
    saveListeningSession("lcr", itemsUsed, result);
  };

  const taskOnExit = isPractice ? () => setPickedItemId(null) : onExit;

  const handleNewSet = () => {
    setSessionKey((k) => k + 1);
  };

  if (type === "lcr") {
    if (isPractice && singleItem) {
      return (
        <LCRTask
          item={singleItem}
          onComplete={handleComplete}
          onExit={taskOnExit}
          isPractice
        />
      );
    }

    return (
      <LCRTask
        batchItems={taskItems}
        onComplete={handleComplete}
        onExit={onExit}
        isPractice={isPractice}
      />
    );
  }

  // Fallback for unknown type
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", background: "#F4F7F5" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🎧</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Unknown task type: {type}</div>
        <button onClick={onExit} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>
          Back to Home
        </button>
      </div>
    </div>
  );
}

export default function ListeningPage() {
  return (
    <Suspense fallback={null}>
      <ListeningPageClient />
    </Suspense>
  );
}
