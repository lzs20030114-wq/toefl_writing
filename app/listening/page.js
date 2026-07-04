"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LCRTask } from "../../components/listening/LCRTask";
import { ListeningMCQTask } from "../../components/listening/ListeningMCQTask";
import { TopicPicker } from "../../components/shared/TopicPicker";
import { getSavedTier } from "../../lib/AuthContext";
import { saveSess, loadDoneIds, addDoneIds } from "../../lib/sessionStore";
import { DONE_STORAGE_KEYS } from "../../lib/questionSelector";
import { listActiveDrafts } from "../../lib/draftPersist";
import { fetchPersonalBank, mapPersonalToPicker } from "../../lib/userBank/personalBank";
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

// LA / LC / LAT practice topic builders. Previously the picker hardcoded LCR for ALL
// four subtypes, so la/lc/lat practice links (\u9996\u9875 mode=practice) resolved into the LCR
// list and then died on a wrong-bank id lookup ("\u6682\u65e0\u9898\u76ee"). Each now builds its own list:
// tag = context/subject, title = situation/topic first line, subtitle = a short descriptor.
function buildLATopics() {
  return (LA_DATA.items || []).map((i) => ({
    id: i.id,
    tag: CONTEXT_LABELS[i.context] || i.context || "Announcement",
    title: firstLine(i.situation || i.announcement),
    subtitle: `${(i.questions || []).length} \u9898`,
  }));
}
function buildLCTopics() {
  return (LC_DATA.items || []).map((i) => ({
    id: i.id,
    tag: CONTEXT_LABELS[i.context] || i.context || "Conversation",
    title: firstLine(i.situation),
    subtitle: `${(i.questions || []).length} \u9898`,
  }));
}
function buildLATTopics() {
  return (LAT_DATA.items || []).map((i) => ({
    id: i.id,
    tag: i.subject || "Lecture",
    title: firstLine(i.topic || i.transcript),
    subtitle: `${(i.questions || []).length} \u9898`,
  }));
}

// Per-subtype picker config: which topic builder, done-key, and picker copy. This replaces
// the LCR-hardcoded practice branch \u2014 la/lc/lat are now first-class practice modes.
const PRACTICE_CONFIG = {
  lcr: {
    build: buildLCRTopics,
    doneKey: DONE_STORAGE_KEYS.LISTENING_LCR,
    title: "Listen & Choose a Response",
    section: "Listening Practice | LCR",
    description: "Listen to a speaker and choose the most appropriate response. No time limit in practice mode.",
  },
  la: {
    build: buildLATopics,
    doneKey: DONE_STORAGE_KEYS.LISTENING_LA,
    title: "Listen to an Announcement",
    section: "Listening Practice | Announcement",
    description: "Listen to a campus announcement and answer the questions. No time limit in practice mode.",
  },
  lc: {
    build: buildLCTopics,
    doneKey: DONE_STORAGE_KEYS.LISTENING_LC,
    title: "Listen to a Conversation",
    section: "Listening Practice | Conversation",
    description: "Listen to a conversation between two speakers and answer the questions. No time limit in practice mode.",
  },
  lat: {
    build: buildLATTopics,
    doneKey: DONE_STORAGE_KEYS.LISTENING_LAT,
    title: "Listen to an Academic Talk",
    section: "Listening Practice | Academic Talk",
    description: "Listen to an academic lecture and answer the questions. No time limit in practice mode.",
  },
};

// Personal question bank wiring: all four listening subtypes (LCR phase 3-1, LA/LAT phase 3-2,
// LC 双说话人 phase 3-3). Every subtype now merges the user's "我的" cards into its practice picker.
const PERSONAL_PRACTICE_TYPES = new Set(["lcr", "la", "lat", "lc"]);

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

  // Personal-bank items for the current subtype (practice only; standard/planner never see them).
  // rawItems drives the picker "我的" cards; personalById resolves the picked id back to the
  // full item so it can be handed to the task component (audio_url may be null → AudioPlayer TTS).
  const [personalRaw, setPersonalRaw] = useState([]);
  useEffect(() => {
    let cancelled = false;
    if (!isPractice || !PERSONAL_PRACTICE_TYPES.has(type)) {
      setPersonalRaw([]);
      return;
    }
    fetchPersonalBank(type)
      .then((rows) => { if (!cancelled) setPersonalRaw(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setPersonalRaw([]); });
    return () => { cancelled = true; };
  }, [type, isPractice]);
  const personalById = new Map(personalRaw.map((p) => [p.id, p]));

  // Standard mode: random batch or single item
  const [randomItems, setRandomItems] = useState(null);
  const [sessionKey, setSessionKey] = useState(0); // force re-render on new set

  useEffect(() => {
    if (isPractice) return;
    // Resume in-progress drafts so a refresh doesn't wipe partial answers.
    // sessionKey forces a fresh batch when the user clicks "下一题" — drafts
    // for previous batches will have been cleared on submit.
    if (type === "lcr") {
      const drafts = listActiveDrafts("lcr");
      if (drafts.length > 0) {
        // Draft scopeId is the joined batch ids — try to resolve them back to items.
        const ids = String(drafts[0].scopeId).split("|");
        const matched = ids.map((id) => LCR_DATA.items.find((it) => it.id === id)).filter(Boolean);
        if (matched.length === ids.length && matched.length > 0) {
          setRandomItems(matched);
          return;
        }
      }
      setRandomItems(pickRandomBatch(LCR_DATA.items, 10));
      return;
    }
    // Single-item subtypes (la / lc / lat) — try to resume by item id first.
    const drafts = listActiveDrafts("listening-mcq");
    const pool = type === "la" ? LA_DATA.items : type === "lc" ? LC_DATA.items : LAT_DATA.items;
    const resume = drafts.map((d) => pool.find((it) => it.id === d.scopeId)).find(Boolean);
    if (resume) {
      setRandomItems([resume]);
      return;
    }
    const item = pickRandom(pool);
    setRandomItems(item ? [item] : []);
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
    const cfg = PRACTICE_CONFIG[type] || PRACTICE_CONFIG.lcr;
    const doneIds = loadDoneIds(cfg.doneKey);
    // Prepend the user's personal "我的" cards before the global bank (practice-only,
    // like the reading/speaking pages). Only wired for types in PERSONAL_PRACTICE_TYPES.
    const personalItems = PERSONAL_PRACTICE_TYPES.has(type)
      ? mapPersonalToPicker(type, personalRaw)
      : [];
    const items = [...personalItems, ...cfg.build()];

    return (
      <TopicPicker
        title={cfg.title}
        section={cfg.section}
        description={cfg.description}
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

  if (isPractice && pickedItemId) {
    // Personal-bank items win over the global bank (both are practice-only). A personal
    // item may have audio_url=null → LCRTask/AudioPlayer falls back to browser TTS.
    singleItem =
      personalById.get(pickedItemId) ||
      (bankData ? bankData.items.find((i) => i.id === pickedItemId) || null : null);
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

    // Collect item data for review (first item for single-item types, all for batch)
    const firstItem = Array.isArray(itemsUsed) ? itemsUsed[0] : itemsUsed;
    const reviewData = {};
    if (subtype === "lcr" && Array.isArray(itemsUsed)) {
      // LCR batch: store each item's speaker + options + audio for review.
      // audio_url lets the history page replay the real recording later;
      // null falls back to TTS off the speaker text.
      reviewData.items = itemsUsed.map(i => ({
        id: i.id, speaker: i.speaker, options: i.options, answer: i.answer,
        explanation: i.explanation, pragmatic_function: i.pragmatic_function,
        audio_url: i.audio_url || null,
      }));
    } else if (subtype === "lcr" && firstItem) {
      reviewData.items = [{
        id: firstItem.id, speaker: firstItem.speaker, options: firstItem.options,
        answer: firstItem.answer, explanation: firstItem.explanation,
        audio_url: firstItem.audio_url || null,
      }];
    } else if (firstItem) {
      // LA/LC/LAT: store transcript + questions + audio for review
      reviewData.transcript = firstItem.transcript || firstItem.announcement || firstItem.lecture || "";
      reviewData.conversation = firstItem.conversation || null;
      reviewData.questions = firstItem.questions || [];
      reviewData.topic = firstItem.topic || firstItem.context || "";
      reviewData.audio_url = firstItem.audio_url || null;
    }

    saveSess({
      type: "listening",
      mode,
      correct: result.correct,
      total: result.total,
      band,
      details: {
        subtype,
        itemIds: Array.isArray(itemsUsed) ? itemsUsed.map((i) => i.id) : [itemsUsed.id],
        results: result.results,
        ...reviewData,
      },
    });
    // Per-subtype done key (was hardcoded to LCR for all four subtypes).
    const doneKey = (PRACTICE_CONFIG[subtype] || PRACTICE_CONFIG.lcr).doneKey;
    addDoneIds(doneKey, Array.isArray(itemsUsed) ? itemsUsed.map((i) => i.id) : [itemsUsed.id]);
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
      taskType={type}
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
