"use client";
// 我的题库（独立页 / 深链兜底）——薄壳：读登录态 + 页面外框，主体交给可复用的 MyBankImporter。
// 首页「我的题库」section 用的是同一个 MyBankImporter（variant="panel"），此页是 /my-bank 深链入口。
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { C, FONT, Btn, PageShell } from "../../components/shared/ui";
import UpgradeModal from "../../components/shared/UpgradeModal";
import { getSavedCode, getSavedTier } from "../../lib/AuthContext";
import MyBankImporter from "../../components/userBank/MyBankImporter";

export default function MyBankPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [code, setCode] = useState("");
  const [tier, setTier] = useState("free");
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
    setCode(getSavedCode() || "");
    setTier(getSavedTier() || "free");
  }, []);

  if (!mounted) return null;

  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: FONT }}>
      {upgradeOpen && (
        <UpgradeModal
          userCode={code}
          currentTier={tier}
          onClose={() => setUpgradeOpen(false)}
          onUpgraded={() => window.location.reload()}
        />
      )}
      <PageShell narrow>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.nav }}>我的题库</div>
            <div style={{ fontSize: 13, color: C.t2, marginTop: 4 }}>
              把你自己的题导入个人库，导入后在练习页会以「我的」标签出现。
            </div>
          </div>
          <Btn variant="secondary" onClick={() => router.push("/")}>返回首页</Btn>
        </div>

        <MyBankImporter
          code={code}
          tier={tier}
          variant="page"
          onRequireUpgrade={() => setUpgradeOpen(true)}
          onRequireLogin={() => router.push("/")}
        />
      </PageShell>
    </div>
  );
}
