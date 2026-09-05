"use client";
// 「真题专区」独立路由（Pro 专属，一期只有写作三题型）。
//
// 与首页 section 面板（components/home/RealExamSectionContent.js）是两套东西：本页不在
// HomePageClient 组件树下，挂在 HomePageClient 上的全局 open-upgrade-modal 事件到不了这里，
// 所以锁定屏必须自持 UpgradeModal（与 app/reading/page.js 同一套实现，契约锁在
// __tests__/real-bank-upgrade.component.test.js）。
//
// 题目注入沿用「个人题库」同款机制，评分/判分链路零改动：
//   讨论 / 邮件 → stashPromptSnapshot() 把整道题塞进 sessionStorage，WritingTask 按
//                 initialPromptId 取快照（real_* id 不在 live 静态库里，只能走这条路）；
//   造句       → BuildSentenceTask 的 questions prop 非空时完全跳过随机选题。

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WritingTask } from "../../components/writing/WritingTask";
import { BuildSentenceTask } from "../../components/buildSentence/BuildSentenceTask";
import { CTWTask } from "../../components/reading/CTWTask";
import { RDLTask } from "../../components/reading/RDLTask";
import UsageGateWrapper from "../../components/shared/UsageGateWrapper";
import UpgradeModal from "../../components/shared/UpgradeModal";
import { TopicPicker } from "../../components/shared/TopicPicker";
import { C, FONT } from "../../components/shared/ui";
import { getSavedCode, getSavedTier } from "../../lib/AuthContext";
import { DONE_STORAGE_KEYS } from "../../lib/questionSelector";
import { addDoneIds, loadDoneIds, saveSess } from "../../lib/sessionStore";
import { PRACTICE_MODE } from "../../lib/practiceMode";
import { normalizeReportLanguage } from "../../lib/reportLanguage";
import { stashPromptSnapshot } from "../../lib/history/retry";
import {
  getRealAPItems,
  getRealBSBatches,
  getRealCTWItems,
  getRealDiscussionPrompts,
  getRealEmailPrompts,
  getRealRDLItems,
  mapRealAPToPicker,
  mapRealBSToPicker,
  mapRealCTWToPicker,
  mapRealDiscussionToPicker,
  mapRealEmailToPicker,
  mapRealRDLToPicker,
  REAL_TIER_NOTE,
  realTierLabel,
} from "../../lib/realBank";

// 与 components/home/sections.js 的 SECTION_ACCENTS["real-bank"] 同色（金琥珀 = 权威感）。
// 各任务页都在本地重复声明科目配色（见 app/reading/page.js:113），这里沿用同一惯例。
const REAL_ACCENT = { color: "#B45309", soft: "#FFF7ED" };

const REAL_TYPES = {
  discussion: { title: "学术讨论真题", section: "真题专区 | 学术讨论" },
  email: { title: "邮件真题", section: "真题专区 | 邮件写作" },
  bs: { title: "造句官方真题", section: "真题专区 | 连词成句" },
  // 阅读三题型：任务名沿用 app/reading/page.js 的 ETS 口径（Complete the Words /
  // Read in Daily Life / Academic Passage），标题保持本页的中文house style。
  ctw: { title: "阅读填词真题", section: "真题专区 | Complete the Words" },
  rdl: { title: "日常阅读真题", section: "真题专区 | Read in Daily Life" },
  ap: { title: "学术阅读真题", section: "真题专区 | Academic Passage" },
};

const READING_TYPES = new Set(["ctw", "rdl", "ap"]);

// 阅读真题的「已练」写进各科目自己的 done key —— 与 app/reading/page.js 同一把钥匙，
// 常规练习做过的题在真题专区也会显示已练（同一道题只有一个 id，本来就该是同一份进度）。
const READING_DONE_KEYS = {
  ctw: DONE_STORAGE_KEYS.READING_CTW,
  rdl: DONE_STORAGE_KEYS.READING_RDL,
  ap: DONE_STORAGE_KEYS.READING_AP,
};

// 缺省 / 非法 type 一律落回讨论（与 app/reading/page.js 的 `type || "ctw"` 同惯例）。
function normalizeRealType(raw) {
  const t = String(raw || "").trim();
  return Object.prototype.hasOwnProperty.call(REAL_TYPES, t) ? t : "discussion";
}

/* ── 答题页顶部的来源标注条 ──────────────────────────────────────── */
// 「真题」是敏感宣称，必须在用户实际看到题目的地方也标清来源分档，不能只标在 picker 上。
function RealSourceBanner({ tierLabel, meta }) {
  return (
    <div
      data-testid="real-source-banner"
      style={{
        display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8,
        padding: "8px 20px", background: REAL_ACCENT.soft,
        borderBottom: `1px solid ${REAL_ACCENT.color}33`,
        fontFamily: FONT, fontSize: 12, color: "#7C2D12", lineHeight: 1.6,
      }}
    >
      <span style={{ fontWeight: 800 }}>📜 真题专区</span>
      <span style={{
        fontWeight: 700, background: "#fff", borderRadius: 999,
        border: `1px solid ${REAL_ACCENT.color}44`, padding: "1px 8px",
      }}>
        {tierLabel}
      </span>
      {meta && <span style={{ opacity: 0.85 }}>{meta}</span>}
    </div>
  );
}

function discussionMeta(prompt) {
  const bits = [];
  if (prompt?.course) bits.push(prompt.course);
  if (prompt?.date) bits.push(`考试日期 ${prompt.date}`);
  if (prompt?.tier === "legacy") bits.push("来源未核验，仅作练习参考");
  return bits.join(" · ");
}

function emailMeta(prompt) {
  if (prompt?.tier === "official") return "ETS 官方 Full-Length Practice Test 原题";
  return "来源未核验，仅作练习参考";
}

// 阅读真题全部是 recalled（考生回忆整理 + 独立盲审通过），不是 ETS 官方 PDF —— 说清楚。
function readingMeta(item) {
  const bits = [];
  if (item?.source) bits.push(item.source);
  if (item?.date) bits.push(`考试日期 ${item.date}`);
  bits.push("考生回忆整理，非 ETS 官方原题");
  return bits.join(" · ");
}

/** 选中的题在库里找不到时的逃生口（不该发生，但别把用户卡在空白页）。 */
function ItemUnavailable({ onBack }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, background: C.bg }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>这道真题暂不可用</div>
        <button onClick={onBack} style={{ padding: "10px 24px", borderRadius: 8, border: `1px solid ${C.bdr}`, background: "#fff", cursor: "pointer", fontSize: 14, fontFamily: FONT }}>
          返回列表
        </button>
      </div>
    </div>
  );
}

/**
 * 阅读真题做完 → 写练习历史 + 打「已练」。
 * 整段照抄 app/reading/page.js:299-323 的 saveReadingSession（band 档位、details 字段名
 * 一个都不能改）—— components/history/ReadingProgressView.js 只认这套 details 形状，
 * 字段对不上就统计不到，用户会觉得「做了没记上」。
 */
function saveRealReadingSession(subtype, itemData, result) {
  const pct = result.total > 0 ? result.correct / result.total : 0;
  const band = pct >= 1 ? 6 : pct >= 0.9 ? 5.5 : pct >= 0.8 ? 5 : pct >= 0.7 ? 4.5 : pct >= 0.6 ? 4 : pct >= 0.5 ? 3.5 : pct >= 0.4 ? 3 : pct >= 0.3 ? 2.5 : 2;
  saveSess({
    type: "reading",
    mode: PRACTICE_MODE.PRACTICE,
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
  addDoneIds(READING_DONE_KEYS[subtype] || DONE_STORAGE_KEYS.READING_RDL, [itemData.id]);
}

/* ── 页面主体 ────────────────────────────────────────────────────── */

function RealBankPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const type = normalizeRealType(searchParams.get("type"));
  const reportLanguage = normalizeReportLanguage(searchParams.get("lang"));

  const [isPro, setIsPro] = useState(false);
  const [userCode, setUserCode] = useState("");
  const [userTier, setUserTier] = useState("free");
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  useEffect(() => {
    const t = getSavedTier();
    setIsPro(t === "pro" || t === "legacy");
    setUserTier(t || "free");
    setUserCode(getSavedCode() || "");
  }, []);

  // 选中的题（写作 / 阅读）/ 批次（造句）；返回 picker 时清空。
  const [pickedPromptId, setPickedPromptId] = useState(null);
  const [pickedBatchId, setPickedBatchId] = useState(null);
  const [pickedReadingId, setPickedReadingId] = useState(null);

  const writingPrompts = useMemo(() => {
    if (type === "email") return getRealEmailPrompts();
    if (type === "discussion") return getRealDiscussionPrompts();
    return [];
  }, [type]);
  const writingById = useMemo(() => {
    const m = new Map();
    for (const p of writingPrompts) m.set(String(p.id), p);
    return m;
  }, [writingPrompts]);
  const writingItems = useMemo(
    () => (type === "email" ? mapRealEmailToPicker(writingPrompts) : mapRealDiscussionToPicker(writingPrompts)),
    [type, writingPrompts]
  );
  const bsBatches = useMemo(() => (type === "bs" ? getRealBSBatches() : []), [type]);

  const readingItems = useMemo(() => {
    if (type === "ctw") return getRealCTWItems();
    if (type === "rdl") return getRealRDLItems();
    if (type === "ap") return getRealAPItems();
    return [];
  }, [type]);
  const readingPickerItems = useMemo(() => {
    if (type === "ctw") return mapRealCTWToPicker(readingItems);
    if (type === "rdl") return mapRealRDLToPicker(readingItems);
    if (type === "ap") return mapRealAPToPicker(readingItems);
    return [];
  }, [type, readingItems]);

  const onExit = () => router.push("/?section=real-bank");

  /* ── Pro 门禁（仿 app/reading/page.js:195-223，锁定屏自持 UpgradeModal） ── */
  if (!isPro) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, background: C.bg }}>
        {upgradeOpen && (
          <UpgradeModal
            userCode={userCode}
            currentTier={userTier}
            onClose={() => setUpgradeOpen(false)}
            onUpgraded={() => window.location.reload()}
          />
        )}
        <div style={{ textAlign: "center", maxWidth: 380, padding: "0 20px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Pro 专属功能</div>
          <div style={{ fontSize: 14, color: C.t2, marginBottom: 20, lineHeight: 1.6 }}>
            真题专区集中收录公开真题（学术讨论 / 邮件 / 造句 / 阅读三题型），仅对 Pro 用户开放。升级 Pro 即可解锁。
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button onClick={() => setUpgradeOpen(true)} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: REAL_ACCENT.color, color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 14, fontFamily: FONT }}>
              升级 Pro
            </button>
            <button onClick={onExit} style={{ padding: "10px 24px", borderRadius: 8, border: `1px solid ${C.bdr}`, background: "#fff", cursor: "pointer", fontSize: 14, fontFamily: FONT }}>
              返回首页
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── 阅读真题：TopicPicker → CTWTask / RDLTask（判分 + 历史与常规练习同一套） ── */
  if (READING_TYPES.has(type)) {
    const readingLabels = REAL_TYPES[type];

    if (!pickedReadingId) {
      // 已练读的正是 app/reading/page.js 写入的那把 key —— 常规练习做过的题在这里也会亮「已练」。
      const doneIds = loadDoneIds(READING_DONE_KEYS[type]);
      return (
        <UsageGateWrapper onExit={onExit} practiceMode={PRACTICE_MODE.PRACTICE}>
          <TopicPicker
            title={readingLabels.title}
            section={readingLabels.section}
            description={`2026 考生回忆整理的阅读真题，独立盲审复核一致后才收录；不限时间、自选题目。${REAL_TIER_NOTE}`}
            items={readingPickerItems}
            doneIds={doneIds}
            accent={REAL_ACCENT}
            onSelect={(id) => setPickedReadingId(String(id))}
            onExit={onExit}
          />
        </UsageGateWrapper>
      );
    }

    const item = readingItems.find((it) => String(it.id) === String(pickedReadingId));
    if (!item) return <ItemUnavailable onBack={() => setPickedReadingId(null)} />;

    const backToPicker = () => setPickedReadingId(null);
    // AP 复用 RDLTask（同一套四选一交互），只把字段名对上：passage→text、topic→genre。
    // 适配对象只喂给组件；存历史 / 打已练一律用原 item（details.passage 那一支自己会挑）。
    const apAsRdl = { ...item, text: item.passage, genre: item.topic };

    return (
      <UsageGateWrapper onExit={backToPicker} practiceMode={PRACTICE_MODE.PRACTICE}>
        <>
          <RealSourceBanner tierLabel={realTierLabel(item.tier)} meta={readingMeta(item)} />
          {type === "ctw" && (
            <CTWTask
              item={item}
              onExit={backToPicker}
              onComplete={(result) => saveRealReadingSession("ctw", item, result)}
              timeLimit={0}
              isPractice
            />
          )}
          {type === "rdl" && (
            <RDLTask
              item={item}
              onExit={backToPicker}
              onComplete={(result) => saveRealReadingSession("rdl", item, result)}
              timeLimit={0}
              isPractice
            />
          )}
          {type === "ap" && (
            <RDLTask
              item={apAsRdl}
              onExit={backToPicker}
              onComplete={(result) => saveRealReadingSession("ap", item, result)}
              timeLimit={0}
              isPractice
              title="Academic Passage"
              section="Reading | Task 3"
            />
          )}
        </>
      </UsageGateWrapper>
    );
  }

  /* ── 造句官方真题：2 张批次卡 → BuildSentenceTask ── */
  if (type === "bs") {
    if (!pickedBatchId) {
      const doneIds = new Set([...loadDoneIds(DONE_STORAGE_KEYS.BUILD_SENTENCE_GP)].map(String));
      return (
        <UsageGateWrapper onExit={onExit} practiceMode={PRACTICE_MODE.PRACTICE}>
          <TopicPicker
            title={REAL_TYPES.bs.title}
            section={REAL_TYPES.bs.section}
            description={`ETS 官方 Full-Length Practice Test 1 & 2 的 20 道连词成句原题（含官方答案）。${REAL_TIER_NOTE}`}
            items={mapRealBSToPicker(bsBatches)}
            doneIds={doneIds}
            accent={REAL_ACCENT}
            onSelect={(id) => setPickedBatchId(String(id))}
            onExit={onExit}
          />
        </UsageGateWrapper>
      );
    }

    const batch = bsBatches.find((b) => b.id === pickedBatchId);
    if (!batch) {
      // 批次 id 对不上（不该发生）——给一个逃生口，别把用户卡在空白页。
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, background: C.bg }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>这套真题暂不可用</div>
            <button onClick={() => setPickedBatchId(null)} style={{ padding: "10px 24px", borderRadius: 8, border: `1px solid ${C.bdr}`, background: "#fff", cursor: "pointer", fontSize: 14, fontFamily: FONT }}>
              返回列表
            </button>
          </div>
        </div>
      );
    }
    return (
      <UsageGateWrapper onExit={() => setPickedBatchId(null)} practiceMode={PRACTICE_MODE.PRACTICE}>
        <>
          <RealSourceBanner tierLabel={realTierLabel("official")} meta={batch.label} />
          <BuildSentenceTask
            questions={batch.questions}
            practiceMode={PRACTICE_MODE.PRACTICE}
            timeLimitSeconds={0}
            onExit={() => setPickedBatchId(null)}
          />
        </>
      </UsageGateWrapper>
    );
  }

  /* ── 讨论 / 邮件真题：TopicPicker → WritingTask（AI 评分链路零改动） ── */
  const doneKey = type === "email" ? DONE_STORAGE_KEYS.EMAIL : DONE_STORAGE_KEYS.DISCUSSION;
  const meta = REAL_TYPES[type];

  if (!pickedPromptId) {
    const doneIds = loadDoneIds(doneKey);
    return (
      <UsageGateWrapper onExit={onExit} practiceMode={PRACTICE_MODE.PRACTICE}>
        <TopicPicker
          title={meta.title}
          section={meta.section}
          description={`公开真题集中练习，不限时间，AI 评分与常规练习一致。${REAL_TIER_NOTE}`}
          items={writingItems}
          doneIds={doneIds}
          accent={REAL_ACCENT}
          onSelect={(id) => {
            // real_* id 不存在于 live 静态题库，必须靠快照交接，否则 WritingTask 报「已下线」。
            const raw = writingById.get(String(id));
            if (raw) stashPromptSnapshot(type, raw);
            setPickedPromptId(String(id));
          }}
          onExit={onExit}
        />
      </UsageGateWrapper>
    );
  }

  const picked = writingById.get(String(pickedPromptId));
  return (
    <UsageGateWrapper onExit={() => setPickedPromptId(null)} practiceMode={PRACTICE_MODE.PRACTICE}>
      <>
        <RealSourceBanner
          tierLabel={realTierLabel(picked?.tier)}
          meta={type === "email" ? emailMeta(picked) : discussionMeta(picked)}
        />
        <WritingTask
          onExit={() => setPickedPromptId(null)}
          type={type}
          practiceMode={PRACTICE_MODE.PRACTICE}
          reportLanguage={reportLanguage}
          initialPromptId={pickedPromptId}
        />
      </>
    </UsageGateWrapper>
  );
}

export default function RealBankPage() {
  return (
    <Suspense fallback={null}>
      <RealBankPageClient />
    </Suspense>
  );
}
