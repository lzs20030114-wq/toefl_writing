"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { checkCanPractice, FREE_DAILY_LIMIT } from "../../lib/dailyUsage";
import UpgradeModal from "../shared/UpgradeModal";
import { CHALLENGE_TOKENS as CH, HOME_FONT, HOME_TOKENS as T } from "./theme";
import { SECTIONS, SECTION_ACCENTS, SECTION_STATUS, TOOLS } from "./sections";
import {
  TierBadge, BindEmailModal, ContactCard, FbStatusBadge, sectionTitle,
} from "./HomeSidebar";

/* ── NavSidebar ── */

export function NavSidebar({
  activeSection,
  onSectionChange,
  isChallenge,
  // user/auth
  userCode, userTier, userEmail, authMethod, isLoggedIn, showLoginModal, onLogout,
  // stats
  totalCount, weekCount, bestMock,
  // feedback
  fbOpen, setFbOpen, fbText, setFbText, fbBusy, fbSent, feedbackMsg, submitFeedback,
  fbHistory, fbHistLoading,
  // code copy
  copied, copyCode,
  logoutHover, setLogoutHover,
  // tools badges
  bsMistakeCount, postWritingCounts,
  // style helpers
  sideCard, fadeIn,
}) {
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [bindEmailOpen, setBindEmailOpen] = useState(false);
  const [boundEmail, setBoundEmail] = useState(userEmail);
  const [freeRemaining, setFreeRemaining] = useState(null);
  const [tierExpiresAt, setTierExpiresAt] = useState(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [codeHidden, setCodeHidden] = useState(true);
  const [contactOpen, setContactOpen] = useState(false);

  const tier = userTier || "free";
  const email = boundEmail || userEmail;
  const isCodeUser = authMethod === "code" || authMethod === "both";
  const isEmailUser = authMethod === "email" || authMethod === "both";
  const showCode = isCodeUser && userCode;

  useEffect(() => {
    if (!isLoggedIn || !userCode) return;
    if (tier === "free") {
      checkCanPractice(userCode, tier).then(({ remaining }) => setFreeRemaining(remaining));
    }
    if (tier === "pro") {
      fetch(`/api/auth/user-info?code=${encodeURIComponent(userCode)}`)
        .then((r) => r.json())
        .then((d) => { if (d.tier_expires_at) setTierExpiresAt(d.tier_expires_at); })
        .catch(() => {});
    }
  }, [isLoggedIn, tier, userCode]);

  const navBg = isChallenge ? CH.navBg : T.navBg;
  const navBdr = isChallenge ? CH.navBdr : T.navBdr;
  const navItemActive = isChallenge ? CH.navItemActive : T.navItemActive;
  const navItemHover = isChallenge ? CH.navItemHover : T.navItemHover;
  const t1 = isChallenge ? CH.t1 : T.t1;
  const t2 = isChallenge ? CH.t2 : T.t2;
  const t3 = isChallenge ? CH.t2 : T.t3;

  return (
    <div
      className="home-nav-sidebar"
      style={{
        width: 220, minWidth: 220, flexShrink: 0,
        position: "sticky", top: 80, alignSelf: "flex-start",
        display: "flex", flexDirection: "column",
        background: navBg,
        borderRight: `1px solid ${navBdr}`,
        borderRadius: 14,
        overflow: "hidden",
        fontFamily: HOME_FONT,
        ...fadeIn(80),
      }}
    >
      {/* ── Portals ── */}
      {logoutConfirm && createPortal(
        <div onClick={() => setLogoutConfirm(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(4px)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: "24px 24px 20px", width: 300, boxShadow: "0 10px 40px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column", gap: 14, fontFamily: HOME_FONT }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#1a2420", marginBottom: 6 }}>确认退出登录？</div>
              <div style={{ fontSize: 13, color: "#5a6b62", lineHeight: 1.6 }}>
                {isEmailUser ? "退出后需重新验证邮箱才能继续使用。" : "退出后需重新输入登录码才能继续使用。"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setLogoutConfirm(false)} style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #dde5df", background: "#fff", color: "#5a6b62", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: HOME_FONT }}>取消</button>
              <button onClick={() => { setLogoutConfirm(false); onLogout(); }} style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: "#dc2626", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: HOME_FONT }}>确认退出</button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {bindEmailOpen && createPortal(
        <BindEmailModal userCode={userCode} onSuccess={(e) => { setBoundEmail(e); setBindEmailOpen(false); }} onClose={() => setBindEmailOpen(false)} />,
        document.body
      )}
      {upgradeOpen && <UpgradeModal userCode={userCode} currentTier={tier} onClose={() => setUpgradeOpen(false)} onUpgraded={() => window.location.reload()} />}

      {/* ── Section navigation ── */}
      <div style={{ padding: "16px 12px 8px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: t3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, paddingLeft: 4 }}>
          Sections
        </div>
        {SECTIONS.map((sec) => {
          const isActive = sec.id === activeSection;
          const isSoon = sec.status === SECTION_STATUS.COMING_SOON;
          const accent = SECTION_ACCENTS[sec.id];
          return (
            <button
              key={sec.id}
              onClick={() => onSectionChange(sec.id)}
              style={{
                width: "100%",
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px",
                borderRadius: 8,
                border: "none",
                background: isActive ? navItemActive : "transparent",
                cursor: "pointer",
                fontFamily: HOME_FONT,
                textAlign: "left",
                transition: "background 150ms ease",
                position: "relative",
                opacity: isSoon ? 0.5 : 1,
                marginBottom: 2,
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = navItemHover; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
            >
              {/* Left accent bar */}
              {isActive && (
                <div style={{
                  position: "absolute", left: 0, top: 8, bottom: 8, width: 3,
                  borderRadius: 2,
                  background: isChallenge ? CH.accent : accent.color,
                }} />
              )}
              <span style={{ fontSize: 16, width: 24, textAlign: "center", flexShrink: 0 }}>{sec.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: isActive ? 700 : 500, color: isActive ? t1 : t2 }}>
                  {sec.label}
                </div>
              </div>
              {isSoon && (
                <span style={{ fontSize: 9, fontWeight: 600, color: t3, background: isChallenge ? "rgba(255,255,255,0.06)" : "#f1f5f9", borderRadius: 4, padding: "2px 6px", flexShrink: 0 }}>
                  即将推出
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Divider ── */}
      <div style={{ height: 1, background: navBdr, margin: "4px 16px" }} />

      {/* ── User section ── */}
      <div style={{ padding: "12px 14px", flex: 1 }}>
        {!isLoggedIn ? (
          /* Not logged in */
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#087355,#0891B2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ color: "#fff", fontSize: 14, fontWeight: 800 }}>?</span>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: t1 }}>未登录</div>
                <div style={{ fontSize: 11, color: t3 }}>登录保存记录</div>
              </div>
            </div>
            <button onClick={showLoginModal} style={{ width: "100%", padding: "8px 0", fontSize: 12, fontWeight: 700, border: "none", background: T.primary, color: "#fff", borderRadius: 8, cursor: "pointer", fontFamily: HOME_FONT }}>
              登录 / 注册
            </button>
          </div>
        ) : (
          /* Logged in */
          <div>
            {/* Compact user row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#087355,#0891B2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ color: "#fff", fontSize: 14, fontWeight: 800 }}>T</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {email ? (
                    <span style={{ fontSize: 12, fontWeight: 700, color: t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email}</span>
                  ) : userCode ? (
                    <>
                      <span style={{ fontSize: 12, fontWeight: 700, color: t1, fontFamily: "monospace", letterSpacing: "0.04em" }}>
                        {codeHidden ? "******" : userCode}
                      </span>
                      <button onClick={() => setCodeHidden((v) => !v)} style={{ border: "none", background: "none", color: t3, fontSize: 11, cursor: "pointer", padding: "1px 2px", lineHeight: 1, fontFamily: HOME_FONT }} title={codeHidden ? "显示" : "隐藏"}>{codeHidden ? "\u{1F441}" : "\u{1F648}"}</button>
                      <button onClick={copyCode} style={{ border: `1px solid ${copied ? T.primary : navBdr}`, background: copied ? T.primarySoft : "transparent", color: copied ? T.primary : t3, borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: HOME_FONT }}>{copied ? "已复制" : "复制"}</button>
                    </>
                  ) : (
                    <span style={{ fontSize: 12, fontWeight: 700, color: t1 }}>用户</span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                  <TierBadge tier={tier} tierExpiresAt={tierExpiresAt} isChallenge={isChallenge} />
                  {tier === "free" && freeRemaining !== null && (
                    <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 999, background: freeRemaining > 0 ? "#f0fdf4" : "#fff5f5", color: freeRemaining > 0 ? "#15803d" : "#dc2626" }}>
                      {freeRemaining}/{FREE_DAILY_LIMIT}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Bind email prompt */}
            {isCodeUser && !email && (
              <button onClick={() => setBindEmailOpen(true)} style={{ fontSize: 11, color: T.primary, background: T.primarySoft, border: `1px solid ${T.primary}`, borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontFamily: HOME_FONT, fontWeight: 600, marginBottom: 6 }}>
                绑定邮箱
              </button>
            )}

            {/* Upgrade button */}
            {tier === "free" && (
              <button onClick={() => setUpgradeOpen(true)} style={{ width: "100%", padding: "7px 0", fontSize: 11, fontWeight: 700, border: "none", background: "linear-gradient(135deg,#087355,#0891B2)", color: "#fff", borderRadius: 6, cursor: "pointer", fontFamily: HOME_FONT, marginBottom: 6 }}>
                升级 Pro
              </button>
            )}
            {tier === "pro" && (
              <button onClick={() => setUpgradeOpen(true)} style={{ width: "100%", padding: "6px 0", fontSize: 11, fontWeight: 600, border: `1px solid ${navBdr}`, background: "transparent", color: t2, borderRadius: 6, cursor: "pointer", fontFamily: HOME_FONT, marginBottom: 6 }}>
                续费
              </button>
            )}

            {/* Inline stats */}
            <div style={{ display: "flex", gap: 12, marginBottom: 8, padding: "6px 0" }}>
              {[
                { label: "练习", value: totalCount > 0 ? String(totalCount) : "-", color: T.primary },
                { label: "7日", value: String(weekCount), color: T.cyan },
                { label: "模考", value: bestMock !== null ? bestMock.toFixed(1) : "-", color: T.amber },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: isChallenge ? CH.t1 : color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
                  <div style={{ fontSize: 9, color: t3 }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Feedback toggle */}
            <button onClick={() => setFbOpen((v) => !v)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "6px 4px", background: "transparent", border: "none", cursor: "pointer", fontFamily: HOME_FONT }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: t2, flex: 1, textAlign: "left" }}>反馈</span>
              <span style={{ fontSize: 10, color: t3, display: "inline-block", transform: fbOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.25s ease" }}>v</span>
            </button>
            <div style={{ maxHeight: fbOpen ? 500 : 0, overflow: "hidden", transition: "max-height 0.35s cubic-bezier(0.25,1,0.5,1)" }}>
              <div style={{ paddingTop: 6 }}>
                <textarea value={fbText} onChange={(e) => setFbText(e.target.value)} placeholder="遇到问题或建议..." style={{ width: "100%", height: 70, resize: "none", background: isChallenge ? "rgba(255,255,255,0.04)" : "#f8fafb", border: `1px solid ${navBdr}`, borderRadius: 8, padding: "6px 8px", fontSize: 11, lineHeight: 1.5, color: t1, fontFamily: HOME_FONT, outline: "none", boxSizing: "border-box" }} />
                <button onClick={submitFeedback} disabled={!fbText.trim() || fbBusy || fbSent} style={{ width: "100%", marginTop: 4, padding: "6px 0", fontSize: 11, fontWeight: 700, borderRadius: 6, border: "none", cursor: fbText.trim() && !fbBusy && !fbSent ? "pointer" : "default", background: fbSent ? T.primarySoft : (fbText.trim() ? T.primary : (isChallenge ? "rgba(255,255,255,0.07)" : "#f1f5f9")), color: fbSent ? T.primary : (fbText.trim() ? "#fff" : t3), fontFamily: HOME_FONT }}>
                  {fbSent ? "已提交" : fbBusy ? "提交中..." : "提交"}
                </button>
                {feedbackMsg && <div style={{ marginTop: 4, fontSize: 10, color: feedbackMsg.ok ? T.primary : T.rose }}>{feedbackMsg.text}</div>}
                {fbHistory.length > 0 && (
                  <div style={{ marginTop: 8, borderTop: `1px solid ${navBdr}`, paddingTop: 6 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: t3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>历史</div>
                    {fbHistory.slice(0, 3).map((item) => (
                      <div key={item.id} style={{ marginBottom: 6, background: isChallenge ? "rgba(255,255,255,0.04)" : "#f8fafb", borderRadius: 6, padding: "5px 7px", border: `1px solid ${navBdr}` }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                          <span style={{ fontSize: 9, color: t3 }}>{new Date(item.created_at).toLocaleDateString("zh-CN")}</span>
                          <FbStatusBadge status={item.status} hasReply={!!item.admin_reply} />
                        </div>
                        <div style={{ fontSize: 10, color: t2, lineHeight: 1.4 }}>{String(item.content || "").slice(0, 50)}{item.content?.length > 50 ? "..." : ""}</div>
                        {item.admin_reply && (
                          <div style={{ marginTop: 3, padding: "3px 5px", background: isChallenge ? "rgba(99,102,241,0.12)" : "#eff6ff", borderRadius: 4, fontSize: 10, color: isChallenge ? "#a5b4fc" : "#1d4ed8", lineHeight: 1.4 }}>
                            <b>回复:</b> {item.admin_reply}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Logout */}
            <button
              onClick={() => setLogoutConfirm(true)}
              onMouseEnter={() => setLogoutHover(true)}
              onMouseLeave={() => setLogoutHover(false)}
              style={{ width: "100%", marginTop: 8, padding: "6px 0", fontSize: 11, fontWeight: 600, border: `1px solid ${logoutHover ? T.rose : navBdr}`, color: logoutHover ? T.rose : t3, background: logoutHover ? T.roseSoft : "transparent", borderRadius: 6, cursor: "pointer", transition: "all .15s", fontFamily: HOME_FONT }}
            >
              退出登录
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
