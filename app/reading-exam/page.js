"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AdaptiveExamShell } from "../../components/mockExam/AdaptiveExamShell";
import UsageGateWrapper from "../../components/shared/UsageGateWrapper";

function ReadingExamClient() {
  const router = useRouter();
  useSearchParams(); // keep this page client-rendered; the mock no longer reads variants
  const onExit = () => router.push("/?section=reading");
  return (
    <UsageGateWrapper onExit={onExit}>
      <AdaptiveExamShell section="reading" onExit={onExit} />
    </UsageGateWrapper>
  );
}

export default function ReadingExamPage() {
  return (
    <Suspense fallback={null}>
      <ReadingExamClient />
    </Suspense>
  );
}
