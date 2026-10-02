"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AdaptiveExamShell } from "../../components/mockExam/AdaptiveExamShell";
import UsageGateWrapper from "../../components/shared/UsageGateWrapper";
import RealMockProGate from "../../components/mockExam/RealMockProGate";

function ListeningExamClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const source = searchParams.get("source") === "real-bank" ? "real-bank" : "standard";
  const onExit = () => router.push(source === "real-bank" ? "/?section=real-bank" : "/?section=listening");
  if (source === "real-bank") return (
    <RealMockProGate onExit={onExit}>
      <AdaptiveExamShell section="listening" source={source} onExit={onExit} />
    </RealMockProGate>
  );
  return (
    <UsageGateWrapper onExit={onExit}>
      <AdaptiveExamShell section="listening" onExit={onExit} />
    </UsageGateWrapper>
  );
}

export default function ListeningExamPage() {
  return (
    <Suspense fallback={null}>
      <ListeningExamClient />
    </Suspense>
  );
}
