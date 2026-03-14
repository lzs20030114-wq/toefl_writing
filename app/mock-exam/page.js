"use client";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MockExamShell } from "../../components/mockExam/MockExamShell";
import UsageGateWrapper from "../../components/shared/UsageGateWrapper";
import { normalizePracticeMode } from "../../lib/practiceMode";
import { normalizeReportLanguage } from "../../lib/reportLanguage";

function MockExamPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = normalizePracticeMode(searchParams.get("mode"));
  const reportLanguage = normalizeReportLanguage(searchParams.get("lang"));
  const onExit = () => router.push("/");
  return (
    <UsageGateWrapper onExit={onExit}>
      <MockExamShell onExit={onExit} mode={mode} reportLanguage={reportLanguage} />
    </UsageGateWrapper>
  );
}

export default function MockExamPage() {
  return (
    <Suspense fallback={null}>
      <MockExamPageClient />
    </Suspense>
  );
}
