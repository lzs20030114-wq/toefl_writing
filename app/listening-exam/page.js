"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AdaptiveExamShell } from "../../components/mockExam/AdaptiveExamShell";
import UsageGateWrapper from "../../components/shared/UsageGateWrapper";

function ListeningExamClient() {
  const router = useRouter();
  const searchParams = useSearchParams(); // force dynamic rendering
  const onExit = () => router.push("/");
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
