"use client";
// 真题专区的 Pro 锁定屏。/real-bank 与 /real-bank/sets 两个独立路由共用 ——
// 它们都不在 HomePageClient 组件树下，全局 open-upgrade-modal 事件到不了，所以自持 UpgradeModal
// （契约锁在 __tests__/real-bank-upgrade.component.test.js）。
import UpgradeModal from "../shared/UpgradeModal";
import { C, FONT } from "../shared/ui";
import { REAL_ACCENT } from "./theme";

export function RealBankLockScreen({ userCode, userTier, upgradeOpen, setUpgradeOpen, onExit }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, background: C.bg }}>
      {upgradeOpen && (
        <UpgradeModal
          userCode={userCode}
          currentTier={userTier}
          onClose={() => setUpgradeOpen(false)}
          onUpgraded={() => window.location.reload()}
        />
      )}
      <div style={{ textAlign: "center", maxWidth: 380, padding: "0 20px" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Pro 专属功能</div>
        <div style={{ fontSize: 14, color: C.t2, marginBottom: 20, lineHeight: 1.6 }}>
          真题专区集中收录公开真题（学术讨论 / 邮件 / 造句 / 阅读三题型），仅对 Pro 用户开放。升级 Pro 即可解锁。
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button onClick={() => setUpgradeOpen(true)} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: REAL_ACCENT.color, color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 14, fontFamily: FONT }}>
            升级 Pro
          </button>
          <button onClick={onExit} style={{ padding: "10px 24px", borderRadius: 8, border: `1px solid ${C.bdr}`, background: "#fff", cursor: "pointer", fontSize: 14, fontFamily: FONT }}>
            返回首页
          </button>
        </div>
      </div>
    </div>
  );
}
