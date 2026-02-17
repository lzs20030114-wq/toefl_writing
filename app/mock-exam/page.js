"use client";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MockExamShell } from "../../components/mockExam/MockExamShell";
import { normalizePracticeMode } from "../../lib/practiceMode";

function MockExamPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = normalizePracticeMode(searchParams.get("mode"));
  return <MockExamShell onExit={() => router.push("/")} mode={mode} />;
}

export default function MockExamPage() {
  return (
    <Suspense fallback={null}>
      <MockExamPageClient />
    </Suspense>
  );
}
