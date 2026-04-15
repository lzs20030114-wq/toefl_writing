"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LCRTask } from "../../components/listening/LCRTask";
import { ListeningMCQTask } from "../../components/listening/ListeningMCQTask";
import { TopicPicker } from "../../components/shared/TopicPicker";
import { getSavedTier } from "../../lib/AuthContext";
import { saveSess, loadDoneIds, addDoneIds } from "../../lib/sessionStore";
import { DONE_STORAGE_KEYS } from "../../lib/questionSelector";
import LCR_DATA from "../../data/listening/bank/lcr.json";
import LA_DATA from "../../data/listening/bank/la.json";
import LC_DATA from "../../data/listening/bank/lc.json";
import LAT_DATA from "../../data/listening/bank/lat.json";

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
      setRandomItems(pickRandomBatch(LCR_DATA.items, 10));
    } else if (type === "la") {
      setRandomItems(pickRandom(LA_DATA.items) ? [pickRandom(LA_DATA.items)] : []);
    } else if (type === "lc") {
      setRandomItems(pickRandom(LC_DATA.items) ? [pickRandom(LC_DATA.items)] : []);
    } else if (type === "lat") {
      setRandomItems(pickRandom(LAT_DATA.items) ? [pickRandom(LAT_DATA.items)] : []);
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

  // ── Resolve data source for current type ──
  const bankMap = { lcr: LCR_DATA, la: LA_DATA, lc: LC_DATA, lat: LAT_DATA };
  const bankData = bankMap[type];

  // Resolve active items
  let taskItems = null;
  let singleItem = null;

  if (isPractice && pickedItemId && bankData) {
    singleItem = bankData.items.find((i) => i.id === pickedItemId) || null;
  } else {
    taskItems = randomItems;
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
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>题目加载中或暂无题目</div>
          <div style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>该题型题库正在扩充，请稍后再试。</div>
          <button onClick={onExit} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer", fontSize: 14 }}>
            返回首页
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
    addDoneIds(DONE_STORAGE_KEYS.LISTENING_LCR, Array.isArray(itemsUsed) ? itemsUsed.map((i) => i.id) : [itemsUsed.id]);
  }

  const taskOnExit = isPractice ? () => setPickedItemId(null) : onExit;
  const handleNewSet = () => setSessionKey((k) => k + 1);

  const TYPE_LABELS = {
    lcr: { title: "Choose a Response", section: "Listening | LCR" },
    la: { title: "Listen to an Announcement", section: "Listening | Announcement" },
    lc: { title: "Listen to a Conversation", section: "Listening | Conversation" },
    lat: { title: "Listen to an Academic Talk", section: "Listening | Academic Talk" },
  };
  const labels = TYPE_LABELS[type] || TYPE_LABELS.lcr;

  // ── LCR: uses specialized LCRTask component ──
  if (type === "lcr") {
    const handleLCRComplete = (result) => {
      saveListeningSession("lcr", isPractice ? singleItem : taskItems, result);
    };

    if (isPractice && singleItem) {
      return <LCRTask item={singleItem} onComplete={handleLCRComplete} onExit={taskOnExit} isPractice />;
    }
    return <LCRTask batchItems={taskItems} onComplete={handleLCRComplete} onExit={onExit} isPractice={isPractice} />;
  }

  // ── LA / LC / LAT: use generic ListeningMCQTask ──
  const activeItem = isPractice ? singleItem : (taskItems && taskItems[0]);
  if (!activeItem) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", background: "#F4F7F5" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎧</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>暂无题目</div>
          <button onClick={onExit} style={{ padding: "10px 24px", marginTop: 16, borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer", fontSize: 14 }}>返回</button>
        </div>
      </div>
    );
  }

  const handleMCQComplete = (result) => {
    saveListeningSession(type, activeItem, result);
    handleNewSet();
  };

  return (
    <ListeningMCQTask
      key={activeItem.id}
      item={activeItem}
      onComplete={handleMCQComplete}
      onExit={isPractice ? taskOnExit : onExit}
      isPractice={isPractice}
      title={labels.title}
      section={labels.section}
    />
  );
}

export default function ListeningPage() {
  return (
    <Suspense fallback={null}>
      <ListeningPageClient />
    </Suspense>
  );
}
