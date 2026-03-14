"use client";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BuildSentenceTask } from "../../components/buildSentence/BuildSentenceTask";
import UsageGateWrapper from "../../components/shared/UsageGateWrapper";
import { getTaskTimeSeconds, normalizePracticeMode } from "../../lib/practiceMode";
import { normalizeReportLanguage } from "../../lib/reportLanguage";

function BuildSentencePageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = normalizePracticeMode(searchParams.get("mode"));
  const reportLanguage = normalizeReportLanguage(searchParams.get("lang"));
  const onExit = () => router.push("/");
  return (
    <UsageGateWrapper onExit={onExit}>
      <BuildSentenceTask
        onExit={onExit}
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
