"use client";
import { useRouter } from "next/navigation";
import { ProgressView } from "../../components/ProgressView";

export default function ProgressPage() {
  const router = useRouter();
  return <ProgressView onBack={() => router.push("/")} />;
}
