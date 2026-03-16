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

function buildBSTopics() {
  const sets = BS_DATA.question_sets || [];
  return sets
    .filter((s) => Array.isArray(s.questions) && s.questions.length > 0)
    .map((s) => {
      const grammarSet = new Set();
      s.questions.forEach((q) => (q.grammar_points || []).forEach((g) => grammarSet.add(g)));
      const grammarTags = [...grammarSet].slice(0, 5).map(translateGrammarPoint).join("、");
      return {
        id: String(s.set_id),
        tag: `${s.questions.length} 题`,
        title: `Set ${s.set_id}`,
        subtitle: grammarTags ? `语法点：${grammarTags}` : `包含 ${s.questions.length} 道拼句题`,
      };
    });
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
    const doneIds = loadDoneIds(DONE_STORAGE_KEYS.BUILD_SENTENCE);
    const doneStrings = new Set([...doneIds].map(String));
    return (
      <UsageGateWrapper onExit={onExit} practiceMode={mode}>
        <TopicPicker
          title="Build a Sentence"
          section="Writing Practice | Task 1"
          items={buildBSTopics()}
          doneIds={doneStrings}
          accent={{ color: "#D97706", soft: "#FFFBEB" }}
          onSelect={(id) => setPickedSetId(id)}
          onExit={onExit}
        />
      </UsageGateWrapper>
    );
  }

  // In practice mode, pass the specific set's questions
  let practiceQuestions = null;
  if (isPractice && pickedSetId) {
    const sets = BS_DATA.question_sets || [];
    const chosen = sets.find((s) => String(s.set_id) === pickedSetId);
    if (chosen) {
      practiceQuestions = chosen.questions.map((q) => ({ ...q, __sourceSetId: chosen.set_id }));
    }
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
