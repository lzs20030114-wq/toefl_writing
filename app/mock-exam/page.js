"use client";
import { useRouter } from "next/navigation";
import { MockExamShell } from "../../components/mockExam/MockExamShell";

export default function MockExamPage() {
  const router = useRouter();
  return <MockExamShell onExit={() => router.push("/")} />;
}
