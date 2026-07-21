"use client";

import { Suspense, useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CTWTask } from "../../components/reading/CTWTask";
import { RDLTask } from "../../components/reading/RDLTask";
import { TopicPicker } from "../../components/shared/TopicPicker";
import { getSavedTier, getSavedCode } from "../../lib/AuthContext";
import UpgradeModal from "../../components/shared/UpgradeModal";
import { saveSess, loadDoneIds, addDoneIds } from "../../lib/sessionStore";
import { DONE_STORAGE_KEYS } from "../../lib/questionSelector";
import { listActiveDrafts } from "../../lib/draftPersist";
import { pickWithTopicDiversity } from "../../lib/recentTopics";
import { fetchPersonalBank, mapPersonalToPicker } from "../../lib/userBank/personalBank";
import CTW_DATA from "../../data/reading/bank/ctw.json";
// RDL bank is split into two pools by question count:
//   rdl-short.json — 83 items, each with 2 questions  → ?variant=short
//   rdl-long.json  — 89 items, each with 3 questions  → ?variant=long
// The legacy data/reading/bank/rdl.json is no longer used by this page
// (still referenced by lib/admin/contentRegistry for older tooling).
import RDL_SHORT_DATA from "../../data/reading/bank/rdl-short.json";
import RDL_LONG_DATA from "../../data/reading/bank/rdl-long.json";
import AP_DATA from "../../data/reading/bank/ap.json";

// Returns the active RDL pool's items[] for the given variant.
function rdlPool(variant) {
  return variant === "short" ? (RDL_SHORT_DATA.items || []) : (RDL_LONG_DATA.items || []);
}

// Map subtype → draft task name (matches CTWTask / RDLTask buildDraftKey)
const DRAFT_TASK_BY_TYPE = { ctw: "ctw", rdl: "rdl", ap: "rdl" };

// Topic key extractors per subtype. RDL passages are tagged by `genre`
// instead of `topic`; CTW and AP both use `topic`.
const TOPIC_KEY_FN = {
  ctw: (it) => String(it?.topic || ""),
  ap: (it) => String(it?.topic || ""),
  rdl: (it) => String(it?.genre || ""),
};

// Pick a reading item enforcing topic diversity: ≠ last topic, AND any 5
// consecutive picks contain ≥ 3 distinct topics. Falls back to uniform random
// if the bank is too narrow to honor the full constraint.
function pickReadingItem(type, items) {
  if (!items || items.length === 0) return null;
  const keyFn = TOPIC_KEY_FN[type] || (() => "");
  return pickWithTopicDiversity(items, `reading::${type}`, keyFn);
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
  return rdlPool(variant).map((i) => ({
    id: i.id,
    tag: GENRE_LABELS[i.genre] || i.genre,
    title: i.format_metadata?.title || i.format_metadata?.subject || firstLine(i.text),
    subtitle: GENRE_LABELS[i.genre] || i.genre,
  }));
}

function buildAPTopics() {
  return (AP_DATA.items || []).map((i) => ({
    id: i.id,
    tag: TOPIC_LABELS[i.topic] || i.topic,
    title: firstLine(i.passage),
    subtitle: i.subtopic || i.topic,
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
    ctw: { standard: 300, challenge: 240 },        // 5 min / 4 min
    rdl: { standard: 240, challenge: 180 },         // 4 min / 3 min
    ap: { standard: 480, challenge: 390 },          // 8 min / 6.5 min
  };
  const timeLimit = isPractice ? 0 : (READING_TIME_LIMITS[type]?.[mode] || 300);

  const [isPro, setIsPro] = useState(false);
  // 此页是独立路由，不在 HomePageClient 树下，全局 open-upgrade-modal 事件监听者到不了这里，
  // 所以锁定屏自持 UpgradeModal（仿 app/speaking-exam/page.js）。
  const [userCode, setUserCode] = useState("");
  const [userTier, setUserTier] = useState("free");
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  useEffect(() => {
    const t = getSavedTier();
    setIsPro(t === "pro" || t === "legacy");
    setUserTier(t || "free");
    setUserCode(getSavedCode() || "");
  }, []);

  // Practice mode: topic picker state
  const [pickedItemId, setPickedItemId] = useState(null);

  // Pick random item for non-practice modes (client side only).
  // If there's an in-progress draft for this subtype, resume that item
  // instead of picking a fresh one — otherwise refresh wipes the user's work.
  const [randomItem, setRandomItem] = useState(null);
  useEffect(() => {
    if (isPractice) return;
    const pool = type === "ap"
      ? (AP_DATA.items || [])
      : type === "rdl"
        ? rdlPool(variant)
        : (CTW_DATA.items || []);
    const draftTask = DRAFT_TASK_BY_TYPE[type] || "ctw";
    const drafts = listActiveDrafts(draftTask);
    // Match draft scopeId against pool item ids (rdl draft can hold both rdl-* and ap-* ids; only the matching ones survive this filter)
    const resume = drafts
      .map((d) => pool.find((it) => String(it?.id) === String(d.scopeId)))
      .find(Boolean);
    setRandomItem(resume || pickReadingItem(type, pool));
  }, [type, variant, isPractice]);

  // 个人题库（用户导入的 rdl/ap/ctw）：运行时拉取，只并入 practice picker（带「我的」标签）；
  // standard/random/draft 恢复零改动（个人题不进随机池）。仿 app/speaking/page.js:83-94。
  const [personalRaw, setPersonalRaw] = useState([]);
  useEffect(() => {
    if (!isPractice || (type !== "rdl" && type !== "ap" && type !== "ctw")) {
      setPersonalRaw([]);
      return;
    }
    let alive = true;
    setPersonalRaw([]);
    fetchPersonalBank(type).then((rows) => { if (alive) setPersonalRaw(rows); });
    return () => { alive = false; };
  }, [type, isPractice]);
  const personalById = useMemo(() => {
    const m = new Map();
    for (const raw of personalRaw) m.set(String(raw.id), raw);
    return m;
  }, [personalRaw]);
  // rdl 按 variant 分池：个人题恰好 2 题 → short 池，否则 → long 池（与静态双池口径一致）。
  const personalForPicker = type === "rdl"
    ? personalRaw.filter((d) => ((d.questions || []).length === 2) === (variant === "short"))
    : personalRaw;

  const onExit = () => router.push("/?section=reading");

  // Gate: Pro only
  if (!isPro) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", background: "#F4F7F5" }}>
        {upgradeOpen && (
          <UpgradeModal
            userCode={userCode}
            currentTier={userTier}
            onClose={() => setUpgradeOpen(false)}
            onUpgraded={() => window.location.reload()}
          />
        )}
        <div style={{ textAlign: "center", maxWidth: 360, padding: "0 20px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Pro 专属功能</div>
          <div style={{ fontSize: 14, color: "#666", marginBottom: 20, lineHeight: 1.6 }}>
            阅读理解模块目前处于测试阶段，仅对 Pro 用户开放。升级 Pro 即可解锁。
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button onClick={() => setUpgradeOpen(true)} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#F59E0B", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 14 }}>
              升级 Pro
            </button>
            <button onClick={onExit} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer", fontSize: 14 }}>
              返回首页
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Practice mode: show TopicPicker when no item selected ──
  if (isPractice && !pickedItemId) {
    const doneKey = type === "ctw" ? DONE_STORAGE_KEYS.READING_CTW : type === "ap" ? DONE_STORAGE_KEYS.READING_AP : DONE_STORAGE_KEYS.READING_RDL;
    const doneIds = loadDoneIds(doneKey);
    // 个人题（「我的」标签）排最前（rdl/ap/ctw 均支持；ctw 无 variant 分池，personalForPicker=personalRaw）。
    const staticItems = type === "ctw" ? buildCTWTopics() : type === "ap" ? buildAPTopics() : buildRDLTopics(variant);
    const items = [...mapPersonalToPicker(type, personalForPicker), ...staticItems];
    const title = type === "ctw" ? "Complete the Words" : type === "ap" ? "Academic Passage" : "Read in Daily Life";
    const section = type === "ctw" ? "Reading Practice | Task 1" : type === "ap" ? "Reading Practice | Task 3" : "Reading Practice | Task 2";

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
    // Find item by ID from the bank. For RDL, look in the variant-specific
    // pool so a short-variant id doesn't accidentally hit a long-variant
    // record (item ids are unique across pools, but using the right pool
    // also keeps the item shape consistent with what the user picked).
    // Personal bank first — usr_ ids never appear in static banks (reserved prefix), so
    // the Map lookup is a pure fallthrough for global picks. No snapshot handoff needed:
    // this page resolves items in-component (unlike the writing pages).
    if (type === "ctw") {
      item = personalById.get(String(pickedItemId)) || CTW_DATA.items.find((i) => i.id === pickedItemId);
    } else if (type === "ap") {
      item = personalById.get(String(pickedItemId)) || AP_DATA.items.find((i) => i.id === pickedItemId);
    } else {
      item = personalById.get(String(pickedItemId)) || rdlPool(variant).find((i) => i.id === pickedItemId);
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
      setRandomItem(pickReadingItem("rdl", rdlPool(variant)));
    } else if (type === "ap") {
      setRandomItem(pickReadingItem("ap", AP_DATA.items));
    } else {
      setRandomItem(pickReadingItem("ctw", CTW_DATA.items));
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
      mode,
      correct: result.correct,
      total: result.total,
      band,
      details: {
        subtype,
        itemId: itemData.id,
        topic: itemData.topic || itemData.genre || "",
        genre: itemData.genre || "",
        results: result.results,
        passage: subtype === "ctw" ? itemData.passage : (itemData.text || itemData.passage),
        blanks: subtype === "ctw" ? itemData.blanks : undefined,
        questions: (subtype === "rdl" || subtype === "ap") ? itemData.questions : undefined,
      },
    });

    // Mark item as done for TopicPicker tracking
    const doneKey = subtype === "ctw" ? DONE_STORAGE_KEYS.READING_CTW : subtype === "ap" ? DONE_STORAGE_KEYS.READING_AP : DONE_STORAGE_KEYS.READING_RDL;
    addDoneIds(doneKey, [itemData.id]);
  }

  const taskOnExit = isPractice ? () => setPickedItemId(null) : onExit;

  if (type === "ap") {
    // AP uses the same MC question interface as RDL but with passage field instead of text
    const apAsRdl = { ...item, text: item.passage, genre: item.topic };
    return (
      <RDLTask
        item={apAsRdl}
        onExit={taskOnExit}
        onComplete={(result) => saveReadingSession("ap", item, result)}
        timeLimit={timeLimit}
        isPractice={isPractice}
        title="Academic Passage"
        section="Reading | Task 3"
      />
    );
  }

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
