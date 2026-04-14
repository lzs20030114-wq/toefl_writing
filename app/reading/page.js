"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CTWTask } from "../../components/reading/CTWTask";
import { RDLTask } from "../../components/reading/RDLTask";
import { TopicPicker } from "../../components/shared/TopicPicker";
import { getSavedTier } from "../../lib/AuthContext";
import { saveSess, loadDoneIds, addDoneIds } from "../../lib/sessionStore";
import { DONE_STORAGE_KEYS } from "../../lib/questionSelector";
import CTW_DATA from "../../data/reading/bank/ctw.json";
import RDL_LONG_DATA from "../../data/reading/bank/rdl-long.json";
import RDL_SHORT_DATA from "../../data/reading/bank/rdl-short.json";

function pickRandom(items) {
  if (!items || items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

/* ── Label maps for TopicPicker ── */

const GENRE_LABELS = {
  notice: "校园通知",
  email: "邮件",
  social_media: "社交媒体",
  syllabus: "课程大纲",
  flyer: "传单/海报",
  schedule: "日程表",
  menu: "菜单",
  text_message: "短信",
};

const TOPIC_LABELS = {
  biology: "Biology",
  environmental_science: "Env. Science",
  psychology: "Psychology",
  history: "History",
  geology: "Geology",
  astronomy: "Astronomy",
  anthropology: "Anthropology",
  technology: "Technology",
  art: "Art",
  sociology: "Sociology",
  chemistry: "Chemistry",
  physics: "Physics",
};

function firstLine(text) {
  if (!text) return "—";
  const line = text.split(/[\n.!?]/).filter(Boolean)[0]?.trim() || text;
  return line.length > 70 ? line.slice(0, 67) + "..." : line;
}

/* ── Build TopicPicker items ── */

function buildCTWTopics() {
  return (CTW_DATA.items || []).map((i) => ({
    id: i.id,
    tag: TOPIC_LABELS[i.topic] || i.topic,
    title: i.first_sentence?.length > 70 ? i.first_sentence.slice(0, 67) + "..." : (i.first_sentence || "—"),
    subtitle: i.subtopic || i.topic,
  }));
}

function buildRDLTopics(variant) {
  const pool = variant === "short" ? RDL_SHORT_DATA : RDL_LONG_DATA;
  return (pool.items || []).map((i) => ({
    id: i.id,
    tag: GENRE_LABELS[i.genre] || i.genre,
    title: i.format_metadata?.title || i.format_metadata?.subject || firstLine(i.text),
    subtitle: GENRE_LABELS[i.genre] || i.genre,
  }));
}

const READING_ACCENT = { color: "#3B82F6", soft: "#EFF6FF" };

/* ── Main page component ── */

function ReadingPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const type = searchParams.get("type") || "ctw";
  const variant = searchParams.get("variant") || "long";
  const mode = searchParams.get("mode") || "standard";
  const isPractice = mode === "practice";

  // Time limits in seconds (0 = no limit for practice mode)
  const READING_TIME_LIMITS = {
    ctw: { standard: 300, challenge: 240 },       // 5 min / 4 min
    "rdl-long": { standard: 240, challenge: 180 }, // 4 min / 3 min
    "rdl-short": { standard: 120, challenge: 90 }, // 2 min / 1.5 min
  };
  const timeLimitKey = type === "rdl" ? `rdl-${variant}` : type;
  const timeLimit = isPractice ? 0 : (READING_TIME_LIMITS[timeLimitKey]?.[mode] || READING_TIME_LIMITS[timeLimitKey]?.standard || 0);

  const [isPro, setIsPro] = useState(false);
  useEffect(() => {
    const t = getSavedTier();
    setIsPro(t === "pro" || t === "legacy");
  }, []);

  // Practice mode: topic picker state
  const [pickedItemId, setPickedItemId] = useState(null);

  // Pick random item for non-practice modes (client side only)
  const [randomItem, setRandomItem] = useState(null);
  useEffect(() => {
    if (isPractice) return; // practice mode uses picker, not random
    if (type === "rdl") {
      const pool = variant === "short" ? RDL_SHORT_DATA.items : RDL_LONG_DATA.items;
      setRandomItem(pickRandom(pool));
    } else {
      setRandomItem(pickRandom(CTW_DATA.items));
    }
  }, [type, variant, isPractice]);

  const onExit = () => router.push("/?section=reading");

  // Gate: Pro only
  if (!isPro) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", background: "#F4F7F5" }}>
        <div style={{ textAlign: "center", maxWidth: 360, padding: "0 20px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Pro 专属功能</div>
          <div style={{ fontSize: 14, color: "#666", marginBottom: 20, lineHeight: 1.6 }}>
            阅读理解模块目前处于测试阶段，仅对 Pro 用户开放。升级 Pro 即可解锁。
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
    const doneKey = type === "ctw" ? DONE_STORAGE_KEYS.READING_CTW : DONE_STORAGE_KEYS.READING_RDL;
    const doneIds = loadDoneIds(doneKey);
    const items = type === "ctw" ? buildCTWTopics() : buildRDLTopics(variant);
    const title = type === "ctw" ? "Complete the Words" : "Read in Daily Life";
    const section = type === "ctw" ? "Reading Practice | Task 1" : `Reading Practice | Task 2 · ${variant === "short" ? "短版" : "长版"}`;

    return (
      <TopicPicker
        title={title}
        section={section}
        items={items}
        doneIds={doneIds}
        accent={READING_ACCENT}
        onSelect={(id) => setPickedItemId(id)}
        onExit={onExit}
      />
    );
  }

  // ── Resolve the active item ──
  let item;
  if (isPractice && pickedItemId) {
    // Find item by ID from the bank
    if (type === "ctw") {
      item = CTW_DATA.items.find((i) => i.id === pickedItemId);
    } else {
      const pool = variant === "short" ? RDL_SHORT_DATA.items : RDL_LONG_DATA.items;
      item = pool.find((i) => i.id === pickedItemId);
    }
  } else {
    item = randomItem;
  }

  function handleNewItem() {
    if (isPractice) {
      // In practice mode, go back to picker instead of random
      setPickedItemId(null);
      return;
    }
    if (type === "rdl") {
      const pool = variant === "short" ? RDL_SHORT_DATA.items : RDL_LONG_DATA.items;
      setRandomItem(pickRandom(pool));
    } else {
      setRandomItem(pickRandom(CTW_DATA.items));
    }
  }

  if (!item) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📖</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>No questions available</div>
          <div style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>Generate questions first using the admin pipeline.</div>
          <button onClick={onExit} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  function saveReadingSession(subtype, itemData, result) {
    const pct = result.total > 0 ? result.correct / result.total : 0;
    const band = pct >= 1 ? 6 : pct >= 0.9 ? 5.5 : pct >= 0.8 ? 5 : pct >= 0.7 ? 4.5 : pct >= 0.6 ? 4 : pct >= 0.5 ? 3.5 : pct >= 0.4 ? 3 : pct >= 0.3 ? 2.5 : 2;
    saveSess({
      type: "reading",
      mode: "standard",
      correct: result.correct,
      total: result.total,
      band,
      details: {
        subtype,
        itemId: itemData.id,
        topic: itemData.topic || itemData.genre || "",
        genre: itemData.genre || "",
        results: result.results,
        passage: subtype === "ctw" ? itemData.passage : itemData.text,
        blanks: subtype === "ctw" ? itemData.blanks : undefined,
        questions: subtype === "rdl" ? itemData.questions : undefined,
      },
    });

    // Mark item as done for TopicPicker tracking
    const doneKey = subtype === "ctw" ? DONE_STORAGE_KEYS.READING_CTW : DONE_STORAGE_KEYS.READING_RDL;
    addDoneIds(doneKey, [itemData.id]);
  }

  const taskOnExit = isPractice ? () => setPickedItemId(null) : onExit;

  if (type === "rdl") {
    return (
      <RDLTask
        item={item}
        onExit={taskOnExit}
        onComplete={(result) => saveReadingSession("rdl", item, result)}
        timeLimit={timeLimit}
        isPractice={isPractice}
      />
    );
  }

  return (
    <CTWTask
      item={item}
      onExit={taskOnExit}
      onComplete={(result) => saveReadingSession("ctw", item, result)}
      timeLimit={timeLimit}
      isPractice={isPractice}
    />
  );
}

export default function ReadingPage() {
  return (
    <Suspense fallback={null}>
      <ReadingPageClient />
    </Suspense>
  );
}
