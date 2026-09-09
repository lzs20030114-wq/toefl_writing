"use client";
import { useRouter } from "next/navigation";
import { RealBankProgressView } from "../../../components/realBank/RealBankProgressView";

// 真题练习记录（/real-bank/progress）：与 /reading/progress 等分科历史页同一挂法。
export default function RealBankProgressPage() {
  const router = useRouter();
  return <RealBankProgressView onBack={() => router.push("/?section=real-bank")} />;
}
