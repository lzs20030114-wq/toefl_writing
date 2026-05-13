"use client";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MistakeNotebook from "../../components/MistakeNotebook";

const ALLOWED_SECTIONS = new Set(["bs", "reading", "listening"]);
const BACK_BY_SECTION = {
  bs: "/?section=writing",
  reading: "/?section=reading",
  listening: "/?section=listening",
};

function MistakeNotebookClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("section");
  const section = ALLOWED_SECTIONS.has(requested) ? requested : "bs";
  return (
    <MistakeNotebook
      initialSection={section}
      onBack={() => router.push(BACK_BY_SECTION[section] || "/")}
    />
  );
}

export default function MistakeNotebookPage() {
  return (
    <Suspense fallback={null}>
      <MistakeNotebookClient />
    </Suspense>
  );
}
