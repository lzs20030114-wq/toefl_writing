"use client";
import { useRouter } from "next/navigation";
import VocabNotebook from "../../components/vocab/VocabNotebook";

export default function VocabNotebookPage() {
  const router = useRouter();
  return <VocabNotebook onBack={() => router.push("/")} />;
}
