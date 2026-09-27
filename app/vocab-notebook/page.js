"use client";

import { Suspense } from "react";
import { useRouter } from "next/navigation";
import LoginGate from "../../components/LoginGate";
import VocabNotebook from "../../components/vocab/VocabNotebook";
import VocabNavigation from "../../components/vocab/VocabNavigation";

function VocabNotebookPageInner(auth) {
  const router = useRouter();
  return (
    <VocabNotebook
      onBack={() => router.push("/")}
      sidebar={<VocabNavigation {...auth} />}
    />
  );
}

export default function VocabNotebookPage() {
  return (
    <Suspense fallback={null}>
      <LoginGate>{(auth) => <VocabNotebookPageInner {...auth} />}</LoginGate>
    </Suspense>
  );
}
