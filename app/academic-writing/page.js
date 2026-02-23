"use client";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WritingTask } from "../../components/writing/WritingTask";
import { getTaskTimeSeconds, normalizePracticeMode } from "../../lib/practiceMode";
import { normalizeReportLanguage } from "../../lib/reportLanguage";

function AcademicWritingPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = normalizePracticeMode(searchParams.get("mode"));
  const reportLanguage = normalizeReportLanguage(searchParams.get("lang"));
  const retryPromptId = String(searchParams.get("retryPromptId") || "").trim();
  const initialPracticeRootId = String(searchParams.get("practiceRootId") || "").trim();
  const retryFromAttempt = Number(searchParams.get("retryFromAttempt") || 0);
  return (
    <WritingTask
      onExit={() => router.push("/")}
      type="discussion"
      timeLimitSeconds={getTaskTimeSeconds("discussion", mode)}
      practiceMode={mode}
      reportLanguage={reportLanguage}
      initialPromptId={retryPromptId}
      initialPracticeRootId={initialPracticeRootId}
      initialPracticeAttempt={Number.isFinite(retryFromAttempt) && retryFromAttempt > 0 ? retryFromAttempt + 1 : 1}
    />
  );
}

export default function AcademicWritingPage() {
  return (
    <Suspense fallback={null}>
      <AcademicWritingPageClient />
    </Suspense>
  );
}
