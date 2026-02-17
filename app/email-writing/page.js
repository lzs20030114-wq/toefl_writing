"use client";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WritingTask } from "../../components/writing/WritingTask";
import { getTaskTimeSeconds, normalizePracticeMode } from "../../lib/practiceMode";

function EmailWritingPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = normalizePracticeMode(searchParams.get("mode"));
  return (
    <WritingTask
      onExit={() => router.push("/")}
      type="email"
      timeLimitSeconds={getTaskTimeSeconds("email", mode)}
      practiceMode={mode}
    />
  );
}

export default function EmailWritingPage() {
  return (
    <Suspense fallback={null}>
      <EmailWritingPageClient />
    </Suspense>
  );
}
