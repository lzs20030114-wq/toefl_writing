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
import EM_DATA from "../../data/emailWriting/prompts.json";

function buildEmailTopics() {
  return (Array.isArray(EM_DATA) ? EM_DATA : [])
    .filter((p) => p && p.id && p.scenario)
    .map((p) => ({
      id: p.id,
      tag: p.to || "",
      title: String(p.scenario || "").split(/[.!?]/).filter(Boolean)[0]?.trim() || p.scenario,
      subtitle: p.scenario,
    }));
}

function EmailWritingPageClient() {
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
    const doneIds = loadDoneIds(DONE_STORAGE_KEYS.EMAIL);
    return (
      <UsageGateWrapper onExit={onExit}>
        <TopicPicker
          title="Write an Email"
          section="Writing Practice | Task 2"
          items={buildEmailTopics()}
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
        type="email"
        timeLimitSeconds={getTaskTimeSeconds("email", mode)}
        practiceMode={mode}
        reportLanguage={reportLanguage}
        initialPromptId={isPractice ? pickedPromptId : retryPromptId}
        initialPracticeRootId={isPractice ? "" : initialPracticeRootId}
        initialPracticeAttempt={isPractice ? 1 : (Number.isFinite(retryFromAttempt) && retryFromAttempt > 0 ? retryFromAttempt + 1 : 1)}
      />
    </UsageGateWrapper>
  );
}

export default function EmailWritingPage() {
  return (
    <Suspense fallback={null}>
      <EmailWritingPageClient />
    </Suspense>
  );
}
