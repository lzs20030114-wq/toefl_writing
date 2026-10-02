"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AdaptiveExamShell } from "../../components/mockExam/AdaptiveExamShell";
import UsageGateWrapper from "../../components/shared/UsageGateWrapper";
import RealMockProGate from "../../components/mockExam/RealMockProGate";

function ReadingExamClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const source = searchParams.get("source") === "real-bank" ? "real-bank" : "standard";
  const onExit = () => router.push(source === "real-bank" ? "/?section=real-bank" : "/?section=reading");
  if (source === "real-bank") return (
    <RealMockProGate onExit={onExit}>
      <AdaptiveExamShell section="reading" source={source} onExit={onExit} />
    </RealMockProGate>
  );
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
