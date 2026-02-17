"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { BuildSentenceTask } from "../../components/buildSentence/BuildSentenceTask";
import { getTaskTimeSeconds, normalizePracticeMode } from "../../lib/practiceMode";

export default function BuildSentencePage() {
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
