"use client";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MockExamShell } from "../../components/mockExam/MockExamShell";
import { normalizePracticeMode } from "../../lib/practiceMode";
import { normalizeReportLanguage } from "../../lib/reportLanguage";

function MockExamPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = normalizePracticeMode(searchParams.get("mode"));
  const reportLanguage = normalizeReportLanguage(searchParams.get("lang"));
  return <MockExamShell onExit={() => router.push("/")} mode={mode} reportLanguage={reportLanguage} />;
}

export default function MockExamPage() {
  return (
    <Suspense fallback={null}>
      <MockExamPageClient />
    </Suspense>
  );
}
