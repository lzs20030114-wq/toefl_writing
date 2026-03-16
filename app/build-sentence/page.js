"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BuildSentenceTask } from "../../components/buildSentence/BuildSentenceTask";
import UsageGateWrapper from "../../components/shared/UsageGateWrapper";
import { TopicPicker } from "../../components/shared/TopicPicker";
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

function BuildSentencePageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = normalizePracticeMode(searchParams.get("mode"));
  const isPractice = mode === PRACTICE_MODE.PRACTICE;
  const reportLanguage = normalizeReportLanguage(searchParams.get("lang"));
  const [pickedSetId, setPickedSetId] = useState(null);
  const onExit = () => router.push(isPractice ? "/?mode=practice" : "/");

  if (isPractice && !pickedSetId) {
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
          onSelect={(id) => setPickedSetId(id)}
          onExit={onExit}
        />
      </UsageGateWrapper>
    );
  }

  // In practice mode, pass questions for the picked grammar category
  let practiceQuestions = null;
  if (isPractice && pickedSetId) {
    practiceQuestions = questionsForCategory(pickedSetId);
  }

  return (
    <UsageGateWrapper onExit={onExit} practiceMode={mode}>
      <BuildSentenceTask
        onExit={isPractice ? () => setPickedSetId(null) : onExit}
        questions={isPractice ? practiceQuestions : undefined}
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
