"use client";
import { useRouter } from "next/navigation";
import MistakeNotebook from "../../components/MistakeNotebook";

export default function MistakeNotebookPage() {
  const router = useRouter();
  return <MistakeNotebook onBack={() => router.push("/")} />;
}
