"use client";

import { Fragment, useEffect, useState } from "react";
import { AUTH_CHANGED_EVENT, getSavedCode, getSavedTier } from "../../lib/AuthContext";
import UpgradeModal from "../shared/UpgradeModal";
import { Btn, C, FONT, SurfaceCard } from "../shared/ui";

/** A route-level guard: a direct URL to a real mock must have Pro access. */
export function RealMockProGate({ children, onExit }) {
  const [account, setAccount] = useState(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  useEffect(() => {
    const refresh = () => setAccount({ code: getSavedCode() || "", tier: getSavedTier() || "free" });
    refresh();
    window.addEventListener(AUTH_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(AUTH_CHANGED_EVENT, refresh); window.removeEventListener("storage", refresh); };
  }, []);
  if (!account) return null;
  if (account.tier === "pro" || account.tier === "legacy") return <Fragment key={`${account.code}:${account.tier}`}>{children}</Fragment>;
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20, background: C.bg, fontFamily: FONT }}>
      <SurfaceCard style={{ maxWidth: 400, padding: 28, textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
        <h1 style={{ color: C.t1, fontSize: 20, margin: "0 0 8px" }}>真题模考 · Pro 专属</h1>
        <p style={{ color: C.t2, fontSize: 14, lineHeight: 1.6 }}>登录 Pro 账号后可使用未做过的真题组成完整模考。</p>
        <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
          <Btn onClick={onExit} variant="secondary">返回真题专区</Btn>
          {account.code && <Btn onClick={() => setUpgradeOpen(true)}>升级 Pro</Btn>}
        </div>
      </SurfaceCard>
      {upgradeOpen && <UpgradeModal userCode={account.code} currentTier={account.tier} onClose={() => setUpgradeOpen(false)} onUpgraded={() => window.location.reload()} />}
    </div>
  );
}

export default RealMockProGate;
