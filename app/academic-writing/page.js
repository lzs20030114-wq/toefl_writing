"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WritingTask } from "../../components/writing/WritingTask";
import UsageGateWrapper from "../../components/shared/UsageGateWrapper";
import { TopicPicker } from "../../components/shared/TopicPicker";
import { getTaskTimeSeconds, normalizePracticeMode, PRACTICE_MODE } from "../../lib/practiceMode";
import { normalizeReportLanguage } from "../../lib/reportLanguage";
import { DONE_STORAGE_KEYS } from "../../lib/questionSelector";
import { loadDoneIds } from "../../lib/sessionStore";
import AD_DATA from "../../data/academicWriting/prompts.json";

function extractShortTitle(professorText) {
  const text = String(professorText || "").trim();
  // Try to find the core question — often after "talk about", "discuss", etc.
  const match = text.match(/(?:talk about|discuss|question[:\s]+)(.*?)(?:[.?]|$)/i);
  if (match) {
    const fragment = match[1].trim();
    if (fragment.length > 5 && fragment.length <= 80) return fragment;
  }
  // Fallback: first sentence, truncated
  const first = text.split(/[.!?]/).filter(Boolean)[0]?.trim() || text;
  return first.length > 80 ? first.slice(0, 77) + "..." : first;
}

function buildAcademicTopics() {
  return (Array.isArray(AD_DATA) ? AD_DATA : [])
    .filter((p) => p && p.id && p.professor?.text)
    .map((p) => ({
      id: p.id,
      tag: p.course || "",
      title: extractShortTitle(p.professor.text),
      subtitle: p.professor.text.length > 120 ? p.professor.text.slice(0, 120) + "..." : p.professor.text,
    }));
}

function AcademicWritingPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = normalizePracticeMode(searchParams.get("mode"));
  const isPractice = mode === PRACTICE_MODE.PRACTICE;
  const reportLanguage = normalizeReportLanguage(searchParams.get("lang"));
  const retryPromptId = String(searchParams.get("retryPromptId") || "").trim();
  const initialPracticeRootId = String(searchParams.get("practiceRootId") || "").trim();
  const retryFromAttempt = Number(searchParams.get("retryFromAttempt") || 0);
  const [pickedPromptId, setPickedPromptId] = useState(null);
  const onExit = () => router.push("/");

  if (isPractice && !pickedPromptId) {
    const doneIds = loadDoneIds(DONE_STORAGE_KEYS.DISCUSSION);
    return (
      <UsageGateWrapper onExit={onExit}>
        <TopicPicker
          title="Academic Discussion"
          section="Writing Practice | Task 3"
          items={buildAcademicTopics()}
          doneIds={doneIds}
          onSelect={(id) => setPickedPromptId(id)}
          onExit={onExit}
        />
      </UsageGateWrapper>
    );
  }

  return (
    <UsageGateWrapper onExit={onExit}>
      <WritingTask
        onExit={isPractice ? () => setPickedPromptId(null) : onExit}
        type="discussion"
        timeLimitSeconds={getTaskTimeSeconds("discussion", mode)}
        practiceMode={mode}
        reportLanguage={reportLanguage}
        initialPromptId={isPractice ? pickedPromptId : retryPromptId}
        initialPracticeRootId={isPractice ? "" : initialPracticeRootId}
        initialPracticeAttempt={isPractice ? 1 : (Number.isFinite(retryFromAttempt) && retryFromAttempt > 0 ? retryFromAttempt + 1 : 1)}
      />
    </UsageGateWrapper>
  );
}

export default function AcademicWritingPage() {
  return (
    <Suspense fallback={null}>
      <AcademicWritingPageClient />
    </Suspense>
  );
}
