"use client";
import { useRouter } from "next/navigation";
import { ReadingProgressView } from "../../../components/reading/ReadingProgressView";

export default function ReadingProgressPage() {
  const router = useRouter();
  return <ReadingProgressView onBack={() => router.push("/")} />;
}
