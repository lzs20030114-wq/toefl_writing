"use client";
// 「真题专区 · 按考试场次」路由（Pro 专属）。
//   /real-bank/sets            → 场次总览（RealSetHub）
//   /real-bank/sets?set=<卷名>  → 单场详情（RealSetDetail）→ 点题跳 /real-bank?type=…&item=…&set=…
//
// 本页只负责导航与「已练」读取；判分 / 历史 / 已练写入全在 /real-bank 题型页原有链路里。
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSavedCode, getSavedTier } from "../../../lib/AuthContext";
import {
  getRealBSQuestions,
  getRealDiscussionPrompts,
  getRealEmailPrompts,
  getRealExamSet,
  getRealExamSets,
  REAL_SET_SECTIONS,
} from "../../../lib/realBank";
import { RealBankLockScreen } from "../../../components/realBank/RealBankLockScreen";
import { RealSetHub } from "../../../components/realBank/RealSetHub";
import { RealSetDetail } from "../../../components/realBank/RealSetDetail";
import { loadRealDoneByType } from "../../../components/realBank/realBankDone";
import { C, FONT } from "../../../components/shared/ui";

const SET_TYPES = REAL_SET_SECTIONS.map((s) => s.key);

function SetUnavailable({ onBack }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, background: C.bg }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>这一场真题暂不可用</div>
        <button onClick={onBack} style={{ padding: "10px 24px", borderRadius: 8, border: `1px solid ${C.bdr}`, background: "#fff", cursor: "pointer", fontSize: 14, fontFamily: FONT }}>
          返回场次列表
        </button>
      </div>
    </div>
  );
}

function RealSetsPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setId = String(searchParams.get("set") || "").trim();

  const [isPro, setIsPro] = useState(false);
  const [userCode, setUserCode] = useState("");
  const [userTier, setUserTier] = useState("free");
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // 「已练」只在浏览器里有；放 state 里由 effect 填，避免首屏 SSR/CSR 不一致。
  const [doneByType, setDoneByType] = useState(() => Object.fromEntries(SET_TYPES.map((t) => [t, new Set()])));

  useEffect(() => {
    const t = getSavedTier();
    setIsPro(t === "pro" || t === "legacy");
    setUserTier(t || "free");
    setUserCode(getSavedCode() || "");
    setDoneByType(loadRealDoneByType(SET_TYPES));
  }, [setId]);

  const sets = useMemo(() => getRealExamSets(), []);
  const typeCounts = useMemo(() => ({
    ctw: sets.reduce((n, s) => n + (s.sections.find((x) => x.key === "ctw")?.items.length || 0), 0),
    rdl: sets.reduce((n, s) => n + (s.sections.find((x) => x.key === "rdl")?.items.length || 0), 0),
    ap: sets.reduce((n, s) => n + (s.sections.find((x) => x.key === "ap")?.items.length || 0), 0),
    discussion: getRealDiscussionPrompts().length,
    email: getRealEmailPrompts().length,
    bs: getRealBSQuestions().length,
  }), [sets]);

  const goHome = () => router.push("/?section=real-bank");
  const goHub = () => router.push("/real-bank/sets");

  if (!isPro) {
    return (
      <RealBankLockScreen
        userCode={userCode} userTier={userTier}
        upgradeOpen={upgradeOpen} setUpgradeOpen={setUpgradeOpen}
        onExit={goHome}
      />
    );
  }

  if (!setId) {
    return <RealSetHub sets={sets} doneByType={doneByType} typeCounts={typeCounts} onExit={goHome} />;
  }

  const set = getRealExamSet(setId);
  if (!set) return <SetUnavailable onBack={goHub} />;

  return (
    <RealSetDetail
      set={set}
      doneByType={doneByType}
      onExit={goHub}
      onSelect={(item) => {
        router.push(`/real-bank?type=${item.type}&item=${encodeURIComponent(item.id)}&set=${encodeURIComponent(set.id)}`);
      }}
    />
  );
}

export default function RealSetsPage() {
  return (
    <Suspense fallback={null}>
      <RealSetsPageClient />
    </Suspense>
  );
}
