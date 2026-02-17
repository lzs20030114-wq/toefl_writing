"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { MockExamShell } from "../../components/mockExam/MockExamShell";
import { normalizePracticeMode } from "../../lib/practiceMode";

export default function MockExamPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = normalizePracticeMode(searchParams.get("mode"));
  return <MockExamShell onExit={() => router.push("/")} mode={mode} />;
}
