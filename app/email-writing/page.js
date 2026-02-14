"use client";
import { useRouter } from "next/navigation";
import { WritingTask } from "../../components/writing/WritingTask";

export default function EmailWritingPage() {
  const router = useRouter();
  return <WritingTask onExit={() => router.push("/")} type="email" />;
}
