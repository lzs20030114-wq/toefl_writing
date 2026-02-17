"use client";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BuildSentenceTask } from "../../components/buildSentence/BuildSentenceTask";
import { getTaskTimeSeconds, normalizePracticeMode } from "../../lib/practiceMode";

function BuildSentencePageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = normalizePracticeMode(searchParams.get("mode"));
  return (
    <BuildSentenceTask
      onExit={() => router.push("/")}
      timeLimitSeconds={getTaskTimeSeconds("build", mode)}
      practiceMode={mode}
    />
  );
}

export default function BuildSentencePage() {
  return (
    <Suspense fallback={null}>
      <BuildSentencePageClient />
    </Suspense>
  );
}
