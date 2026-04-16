"use client";
import { useRouter } from "next/navigation";
import { ListeningProgressView } from "../../../components/listening/ListeningProgressView";

export default function ListeningProgressPage() {
  const router = useRouter();
  return <ListeningProgressView onBack={() => router.push("/?section=listening")} />;
}
