"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BuildSentenceTask } from "../../components/buildSentence/BuildSentenceTask";
import UsageGateWrapper from "../../components/shared/UsageGateWrapper";
import { TopicPicker } from "../../components/shared/TopicPicker";
import { C, FONT, Btn, PageShell, SurfaceCard, TopBar } from "../../components/shared/ui";
import { getTaskTimeSeconds, normalizePracticeMode, PRACTICE_MODE } from "../../lib/practiceMode";
import { normalizeReportLanguage } from "../../lib/reportLanguage";
import { DONE_STORAGE_KEYS } from "../../lib/questionSelector";
import { loadDoneIds } from "../../lib/sessionStore";
import { translateGrammarPoint } from "../../lib/utils";
import BS_DATA from "../../data/buildSentence/questions.json";

/* ── Grammar-point canonical category mapping ─────────────────────── */
function grammarCategory(rawTag) {
  const t = (rawTag || "").trim().toLowerCase().replace(/[_-]/g, " ");
  if (t.includes("embedded") || t === "indirect question" || t.startsWith("1st ")) return "间接疑问句";
  if (t.includes("negation") || t === "negative") return "否定结构";
  if (t.includes("passive")) return "被动语态";
  if (t.includes("relative") || t.includes("contact") || t === "whom") return "从句";
  if (t === "interrogative") return "疑问句";
  if (t.includes("report") || t === "indirect speech") return "引语转述";
  if (/past|present|future|tense/.test(t)) return "时态";
  if (t.includes("clause")) return "从句";
  return "其他";
}

const CATEGORY_ORDER = ["间接疑问句", "否定结构", "时态", "从句", "被动语态", "疑问句", "引语转述", "其他"];

/* ── Build grammar-point-based topics for practice mode ───────────── */
function buildGrammarTopics() {
  const allQuestions = (BS_DATA.question_sets || []).flatMap((s) => s.questions || []);
  const groups = {};

  for (const q of allQuestions) {
    const cats = new Set((q.grammar_points || []).map(grammarCategory));
    if (cats.size === 0) cats.add("其他");
    for (const cat of cats) {
      if (!groups[cat]) groups[cat] = { questions: [], subPoints: new Set() };
      groups[cat].questions.push(q);
      (q.grammar_points || []).forEach((gp) => {
        if (grammarCategory(gp) === cat) groups[cat].subPoints.add(translateGrammarPoint(gp));
      });
    }
  }

  return CATEGORY_ORDER
    .filter((cat) => groups[cat] && groups[cat].questions.length > 0)
    .map((cat) => {
      const g = groups[cat];
      const subList = [...g.subPoints].slice(0, 4).join("、");
      return {
        id: `gp-${cat}`,
        tag: `${g.questions.length} 题`,
        title: cat,
        subtitle: subList && subList !== cat ? subList : "",
      };
    });
}

/* ── Collect questions for a grammar category ─────────────────────── */
function questionsForCategory(categoryId) {
  const cat = categoryId.replace(/^gp-/, "");
  const allQuestions = (BS_DATA.question_sets || []).flatMap((s) => s.questions || []);
  return allQuestions
    .filter((q) => {
      const cats = new Set((q.grammar_points || []).map(grammarCategory));
      if (cats.size === 0) cats.add("其他");
      return cats.has(cat);
    })
    .map((q) => ({ ...q, __sourceGroupId: categoryId }));
}

/* ── Practice progress persistence ────────────────────────────────── */
const BS_PRACTICE_PROGRESS_KEY = "toefl-bs-practice-progress";
const BATCH_SIZE = 10;

function loadAllProgress() {
  try { return JSON.parse(localStorage.getItem(BS_PRACTICE_PROGRESS_KEY) || "{}"); } catch { return {}; }
}

function loadBatchProgress(categoryId, batchIdx) {
  return loadAllProgress()[`${categoryId}::${batchIdx}`] || null;
}

function saveBatchProgress(categoryId, batchIdx, data) {
  try {
    const all = loadAllProgress();
    all[`${categoryId}::${batchIdx}`] = data;
    localStorage.setItem(BS_PRACTICE_PROGRESS_KEY, JSON.stringify(all));
  } catch {}
}

/* ── Batch questions for a category ──────────────────────────────── */
function getBatchesForCategory(categoryId) {
  const questions = questionsForCategory(categoryId);
  const batches = [];
  for (let i = 0; i < questions.length; i += BATCH_SIZE) {
    batches.push(questions.slice(i, i + BATCH_SIZE));
  }
  return batches;
}

/* ── Set List View ───────────────────────────────────────────────── */
function PracticeSetList({ categoryId, onSelect, onBack }) {
  const catName = categoryId.replace(/^gp-/, "");
  const batches = getBatchesForCategory(categoryId);
  const totalQ = batches.reduce((s, b) => s + b.length, 0);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <TopBar title={catName} section="Build a Sentence · 练习模式" onExit={onBack} />
      <PageShell narrow>
        <div style={{ fontSize: 13, color: C.t2, marginBottom: 16 }}>
          共 {totalQ} 题 · {batches.length} 套
        </div>
        {batches.map((batch, i) => {
          const progress = loadBatchProgress(categoryId, i);
          const total = batch.length;
          let statusText, statusColor, statusBg;

          const answered = progress ? (progress.results || []).filter((r) => r !== null).length : 0;
          const isComplete = progress?.completed;
          const actionText = !progress ? "开始练习" : isComplete ? "重新练习" : "继续练习";

          return (
            <SurfaceCard
              key={i}
              style={{
                padding: "16px 20px", marginBottom: 10, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                transition: "box-shadow 0.15s",
              }}
              onClick={() => onSelect(i)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: C.t1, marginBottom: 6 }}>
                  第 {i + 1} 套
                  <span style={{ fontSize: 12, color: C.t3, fontWeight: 400, marginLeft: 8 }}>{total} 题</span>
                  {isComplete && <span style={{ fontSize: 11, color: "#059669", marginLeft: 8, fontWeight: 500 }}>({progress.correct}/{progress.total} 正确)</span>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, height: 6, borderRadius: 3, background: "#E5E7EB", overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 3,
                      width: `${total > 0 ? (answered / total) * 100 : 0}%`,
                      background: isComplete ? "#059669" : C.blue,
                      transition: "width 0.3s ease",
                    }} />
                  </div>
                  <span style={{ fontSize: 11, color: C.t3, whiteSpace: "nowrap", minWidth: 36, textAlign: "right" }}>{answered}/{total}</span>
                </div>
              </div>
              <span style={{ fontSize: 13, color: C.blue, fontWeight: 500 }}>{actionText} →</span>
            </SurfaceCard>
          );
        })}
        <div style={{ marginTop: 20 }}>
          <Btn onClick={onBack} variant="secondary">← 返回选择题型</Btn>
        </div>
      </PageShell>
    </div>
  );
}

/* ── Page Client ─────────────────────────────────────────────────── */
function BuildSentencePageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = normalizePracticeMode(searchParams.get("mode"));
  const isPractice = mode === PRACTICE_MODE.PRACTICE;
  const reportLanguage = normalizeReportLanguage(searchParams.get("lang"));
  const [pickedCategoryId, setPickedCategoryId] = useState(null);
  const [pickedBatchIdx, setPickedBatchIdx] = useState(null);
  const onExit = () => router.push(isPractice ? "/?mode=practice" : "/");

  /* Stage 1: Category picker */
  if (isPractice && !pickedCategoryId) {
    const doneIds = loadDoneIds(DONE_STORAGE_KEYS.BUILD_SENTENCE_GP);
    const doneStrings = new Set([...doneIds].map(String));
    return (
      <UsageGateWrapper onExit={onExit} practiceMode={mode}>
        <TopicPicker
          title="Build a Sentence"
          section="Writing Practice | Task 1"
          items={buildGrammarTopics()}
          doneIds={doneStrings}
          accent={{ color: "#D97706", soft: "#FFFBEB" }}
          onSelect={(id) => setPickedCategoryId(id)}
          onExit={onExit}
        />
      </UsageGateWrapper>
    );
  }

  /* Stage 2: Set list */
  if (isPractice && pickedCategoryId && pickedBatchIdx === null) {
    return (
      <UsageGateWrapper onExit={onExit} practiceMode={mode}>
        <PracticeSetList
          categoryId={pickedCategoryId}
          onSelect={(idx) => setPickedBatchIdx(idx)}
          onBack={() => setPickedCategoryId(null)}
        />
      </UsageGateWrapper>
    );
  }

  /* Stage 3: Task */
  let practiceQuestions = null;
  let initialResults = null;
  if (isPractice && pickedCategoryId && pickedBatchIdx !== null) {
    const batches = getBatchesForCategory(pickedCategoryId);
    practiceQuestions = batches[pickedBatchIdx] || [];

    const progress = loadBatchProgress(pickedCategoryId, pickedBatchIdx);
    if (progress && !progress.completed && Array.isArray(progress.results)) {
      // Validate question IDs still match
      const ids = practiceQuestions.map((q) => q.id);
      if (progress.questionIds && JSON.stringify(progress.questionIds) === JSON.stringify(ids)) {
        initialResults = progress.results;
      }
    }
  }

  function handleTaskExit(info) {
    if (info?.completed && isPractice) {
      const correct = (info.results || []).filter((r) => r?.isCorrect).length;
      saveBatchProgress(pickedCategoryId, pickedBatchIdx, {
        questionIds: practiceQuestions.map((q) => q.id),
        results: (info.results || []).map((r) =>
          r ? { userAnswer: r.userAnswer, correctAnswer: r.correctAnswer, isCorrect: r.isCorrect } : null
        ),
        completed: true,
        correct,
        total: (info.results || []).length,
      });
    }
    if (isPractice) {
      setPickedBatchIdx(null);
    } else {
      onExit();
    }
  }

  function handleSaveExit(progress) {
    saveBatchProgress(pickedCategoryId, pickedBatchIdx, {
      questionIds: practiceQuestions.map((q) => q.id),
      results: (progress.results || []).map((r) =>
        r ? { userAnswer: r.userAnswer, correctAnswer: r.correctAnswer, isCorrect: r.isCorrect } : null
      ),
      completed: false,
    });
    setPickedBatchIdx(null);
  }

  return (
    <UsageGateWrapper onExit={isPractice ? () => setPickedBatchIdx(null) : onExit} practiceMode={mode}>
      <BuildSentenceTask
        onExit={handleTaskExit}
        onSaveExit={isPractice ? handleSaveExit : undefined}
        questions={isPractice ? practiceQuestions : undefined}
        initialResults={isPractice ? initialResults : undefined}
        timeLimitSeconds={getTaskTimeSeconds("build", mode)}
        practiceMode={mode}
        reportLanguage={reportLanguage}
      />
    </UsageGateWrapper>
  );
}

export default function BuildSentencePage() {
  return (
    <Suspense fallback={null}>
      <BuildSentencePageClient />
    </Suspense>
  );
}
