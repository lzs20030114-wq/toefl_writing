"use client";
import { useRouter } from "next/navigation";
import { BuildSentenceTask } from "../../components/buildSentence/BuildSentenceTask";

export default function BuildSentencePage() {
  const router = useRouter();
  return <BuildSentenceTask onExit={() => router.push("/")} />;
}
