"use client";
import { useRouter } from "next/navigation";
import { SpeakingProgressView } from "../../../components/speaking/SpeakingProgressView";

export default function SpeakingProgressPage() {
  const router = useRouter();
  return <SpeakingProgressView onBack={() => router.push("/?section=speaking")} />;
}
