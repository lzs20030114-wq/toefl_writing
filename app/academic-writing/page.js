"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { WritingTask } from "../../components/writing/WritingTask";
import { getTaskTimeSeconds, normalizePracticeMode } from "../../lib/practiceMode";

export default function AcademicWritingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = normalizePracticeMode(searchParams.get("mode"));
  return (
    <WritingTask
      onExit={() => router.push("/")}
      type="discussion"
      timeLimitSeconds={getTaskTimeSeconds("discussion", mode)}
      practiceMode={mode}
    />
  );
}
