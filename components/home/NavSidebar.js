"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { checkCanPractice, FREE_DAILY_LIMIT } from "../../lib/dailyUsage";
import UpgradeModal from "../shared/UpgradeModal";
import { CHALLENGE_TOKENS as CH, HOME_FONT, HOME_TOKENS as T } from "./theme";
import { SECTIONS, SECTION_ACCENTS, SECTION_STATUS } from "./sections";
import { TierBadge, BindEmailModal } from "./sidebarWidgets";
import { SupportModal } from "./SupportModal";
import { openFirstSetSurvey } from "../../lib/survey/openFirstSetSurvey";
import { VocabNavItem } from "../vocab/VocabNavItem";
import { countUnseenReplies, loadSeenReplyIds, repliedIds, saveSeenReplyIds } from "../../lib/feedback/replySeen";

/* ── NavSidebar ──
 *
 * 结构（自上而下）：Sections 导航 → 账户卡 → 入口列表。
 * 设计约束：侧栏 sticky 贴顶，内容必须能在一屏内放下 —— 所以这里不再放任何折叠展开区
 * （反馈表单 / 微信群二维码以前都塞在这里，展开就掉出视口）。会长高的内容一律走弹窗：
 *   - 反馈 / 反馈记录 / 微信群 → SupportModal
 *   - 绑定邮箱 / 续费 / 退出登录 → 账户「···」菜单（portal 浮层）
 * 兜底：侧栏本身限高 + 内部可滚，小窗口下也不会再被裁掉。
 */

/* 侧栏安静列表项：入口统一用这个中性样式，避免各处内联复制后漂移 */
function SidebarActionItem({ emoji, title, sub, badge, onClick, navBdr, navItemHover, t1, t3, style, testId }) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      style={{
        width: "100%",
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 10px",
        background: "transparent",
        border: `1px solid ${navBdr}`,
        borderRadius: 8,
        cursor: "pointer",
        fontFamily: HOME_FONT,
        textAlign: "left",
        transition: "background 0.15s ease",
        ...style,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = navItemHover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ fontSize: 14, flexShrink: 0 }}>{emoji}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: t1, lineHeight: 1.3 }}>{title}</div>
        {sub && <div style={{ fontSize: 10, color: t3, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>}
      </div>
      {badge ? (
        <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: T.indigo, borderRadius: 999, padding: "2px 7px", flexShrink: 0 }}>{badge}</span>
      ) : (
        <span style={{ fontSize: 11, color: t3, flexShrink: 0 }}>›</span>
      )}
    </button>
  );
}

/* 账户「···」菜单：portal 到 body 的定位浮层（侧栏 overflow 裁剪，不能内联渲染） */
function AccountMenu({ anchorRef, open, onClose, items }) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (!open) { setPos(null); return; }
    const r = anchorRef.current?.getBoundingClientRect();
    const width = 188;
    if (r) setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)) });
    function onDown(e) {
      if (anchorRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      onClose();
    }
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [open, anchorRef, onClose]);

  if (!open || !pos || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      data-testid="account-menu"
      style={{
        position: "fixed", top: pos.top, left: pos.left, width: 188, zIndex: 9000,
        background: "#fff", border: `1px solid ${T.bdr}`, borderRadius: 10,
        boxShadow: "0 10px 30px rgba(15,23,42,0.14)", padding: 6, fontFamily: HOME_FONT,
      }}
    >
      {items.map((it, i) => (
        it.divider ? (
          <div key={`d${i}`} style={{ height: 1, background: T.bdrSubtle, margin: "4px 4px" }} />
        ) : (
          <button
            key={it.label}
            role="menuitem"
            onClick={() => { onClose(); it.onClick(); }}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 8,
              padding: "8px 10px", borderRadius: 7, border: "none", background: "transparent",
              cursor: "pointer", textAlign: "left", fontFamily: HOME_FONT,
              fontSize: 13, fontWeight: 600, color: it.danger ? T.rose : T.t1,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = it.danger ? T.roseSoft : T.navItemHover; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <span style={{ width: 18, textAlign: "center", fontSize: 13, flexShrink: 0 }}>{it.icon}</span>
            <span style={{ flex: 1, minWidth: 0 }}>{it.label}</span>
            {it.hint && <span style={{ fontSize: 10, color: T.t3, flexShrink: 0 }}>{it.hint}</span>}
          </button>
        )
      ))}
    </div>,
    document.body
  );
}

/* Pro 到期前多少天把「续费」提到账户卡上（其余时间只在菜单里） */
export const RENEW_NUDGE_DAYS = 14;

function daysUntil(iso) {
  if (!iso) return null;
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return Number.isFinite(diff) ? diff : null;
}

export function NavSidebar({
  activeSection,
  onSectionChange,
  isChallenge,
  // user/auth
  userCode, userTier, userEmail, authMethod, isLoggedIn, showLoginModal, onLogout,
  // feedback
  fbOpen, setFbOpen, fbText, setFbText, fbBusy, fbSent, feedbackMsg, submitFeedback,
  fbHistory = [],
  // code copy
  copied, copyCode,
  // referral
  onOpenReferral,
  // style helpers
  fadeIn,
}) {
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [bindEmailOpen, setBindEmailOpen] = useState(false);
  const [boundEmail, setBoundEmail] = useState(userEmail);
  const [freeRemaining, setFreeRemaining] = useState(null);
  const [tierExpiresAt, setTierExpiresAt] = useState(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [codeHidden, setCodeHidden] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [supportTab, setSupportTab] = useState("feedback");
  const [seenReplyIds, setSeenReplyIds] = useState([]);
  const menuAnchorRef = useRef(null);

  const tier = userTier || "free";
  const email = boundEmail || userEmail;
  const isCodeUser = authMethod === "code" || authMethod === "both";
  const isEmailUser = authMethod === "email" || authMethod === "both";

  useEffect(() => { setSeenReplyIds(loadSeenReplyIds()); }, []);

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

  const unseenReplies = isLoggedIn ? countUnseenReplies(fbHistory, seenReplyIds) : 0;
  const markRepliesSeen = useCallback(() => {
    const ids = repliedIds(fbHistory);
    if (!ids.length) return;
    setSeenReplyIds((prev) => {
      const next = Array.from(new Set([...prev, ...ids]));
      if (next.length === prev.length) return prev;
      saveSeenReplyIds(next);
      return next;
    });
  }, [fbHistory]);

  function openSupport(tabId) {
    setSupportTab(tabId);
    setFbOpen(true);
  }
  const closeSupport = useCallback(() => setFbOpen(false), [setFbOpen]);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const navBg = isChallenge ? CH.navBg : T.navBg;
  const navBdr = isChallenge ? CH.navBdr : T.navBdr;
  const navItemActive = isChallenge ? CH.navItemActive : T.navItemActive;
  const navItemHover = isChallenge ? CH.navItemHover : T.navItemHover;
  const t1 = isChallenge ? CH.t1 : T.t1;
  const t2 = isChallenge ? CH.t2 : T.t2;
  const t3 = isChallenge ? CH.t2 : T.t3;

  const proDaysLeft = tier === "pro" ? daysUntil(tierExpiresAt) : null;
  const showRenewOnCard = tier === "pro" && proDaysLeft !== null && proDaysLeft <= RENEW_NUDGE_DAYS;

  const menuItems = [
    ...(isCodeUser && !email ? [{ icon: "✉️", label: "绑定邮箱", hint: "防丢账号", onClick: () => setBindEmailOpen(true) }] : []),
    ...(tier === "pro" ? [{ icon: "💎", label: "续费 Pro", hint: proDaysLeft !== null ? `剩 ${Math.max(proDaysLeft, 0)} 天` : "", onClick: () => setUpgradeOpen(true) }] : []),
    ...(tier === "free" ? [{ icon: "💎", label: "升级 Pro", onClick: () => setUpgradeOpen(true) }] : []),
    { divider: true },
    { icon: "⏏", label: "退出登录", danger: true, onClick: () => setLogoutConfirm(true) },
  ];

  return (
    <div
      className="home-nav-sidebar"
      style={{
        width: 220, minWidth: 220, flexShrink: 0,
        position: "sticky", top: 80, alignSelf: "flex-start",
        // 兜底：矮视口下侧栏自己滚，不再被视口底部裁掉
        maxHeight: "calc(100vh - 96px)", overflowY: "auto", scrollbarWidth: "thin",
        display: "flex", flexDirection: "column",
        background: navBg,
        borderRight: `1px solid ${navBdr}`,
        borderRadius: 14,
        fontFamily: HOME_FONT,
        ...fadeIn(80),
      }}
    >
      {/* ── Portals ── */}
      {logoutConfirm && createPortal(
        <div onClick={() => setLogoutConfirm(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", WebkitBackdropFilter: "blur(4px)", backdropFilter: "blur(4px)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: "24px 24px 20px", width: 300, boxShadow: "0 10px 40px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column", gap: 14, fontFamily: HOME_FONT }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.t1, marginBottom: 6 }}>确认退出登录？</div>
              <div style={{ fontSize: 13, color: T.t2, lineHeight: 1.6 }}>
                {isEmailUser ? "退出后需重新验证邮箱才能继续使用。" : "退出后需重新输入登录码才能继续使用。"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setLogoutConfirm(false)} style={{ padding: "7px 16px", borderRadius: 8, border: `1px solid ${T.bdr}`, background: "#fff", color: T.t2, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: HOME_FONT }}>取消</button>
              <button onClick={() => { setLogoutConfirm(false); onLogout(); }} style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: T.rose, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: HOME_FONT }}>确认退出</button>
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
      <AccountMenu anchorRef={menuAnchorRef} open={menuOpen} onClose={closeMenu} items={menuItems} />
      <SupportModal
        open={!!fbOpen} onClose={closeSupport} initialTab={supportTab}
        isLoggedIn={isLoggedIn} showLoginModal={showLoginModal}
        fbText={fbText} setFbText={setFbText} fbBusy={fbBusy} fbSent={fbSent}
        feedbackMsg={feedbackMsg} submitFeedback={submitFeedback}
        fbHistory={fbHistory} unseenReplies={unseenReplies} onHistoryViewed={markRepliesSeen}
      />

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
              data-section-id={sec.id}
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
                <span style={{ fontSize: 10, fontWeight: 600, color: t3, background: isChallenge ? "rgba(255,255,255,0.06)" : T.navItemHover, borderRadius: 4, padding: "2px 6px", flexShrink: 0 }}>
                  即将推出
                </span>
              )}
            </button>
          );
        })}
        {/* 单词本：独立路由，挂在 section 列表末尾（原来在右栏页底，不显眼） */}
        <VocabNavItem isChallenge={isChallenge} />
      </div>

      {/* ── Divider ── */}
      <div style={{ height: 1, background: navBdr, margin: "4px 16px" }} />

      {/* ── Account card ── */}
      <div style={{ padding: "12px 14px 6px" }}>
        {!isLoggedIn ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#087355,#0891B2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>?</span>
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
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#087355,#0891B2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>T</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {email ? (
                    <span title={email} style={{ fontSize: 12, fontWeight: 700, color: t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email}</span>
                  ) : userCode ? (
                    <>
                      <span style={{ fontSize: 12, fontWeight: 700, color: t1, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', monospace", letterSpacing: "0.04em" }}>
                        {codeHidden ? "******" : userCode}
                      </span>
                      <button onClick={() => setCodeHidden((v) => !v)} style={{ border: "none", background: "none", color: t3, fontSize: 11, cursor: "pointer", padding: "1px 2px", lineHeight: 1, fontFamily: HOME_FONT }} title={codeHidden ? "显示登录码" : "隐藏登录码"}>{codeHidden ? "👁" : "🙈"}</button>
                      <button onClick={copyCode} style={{ border: `1px solid ${copied ? T.primary : navBdr}`, background: copied ? T.primarySoft : "transparent", color: copied ? T.primary : t3, borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: HOME_FONT }}>{copied ? "已复制" : "复制"}</button>
                    </>
                  ) : (
                    <span style={{ fontSize: 12, fontWeight: 700, color: t1 }}>用户</span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                  <TierBadge tier={tier} tierExpiresAt={tierExpiresAt} isChallenge={isChallenge} />
                  {tier === "free" && freeRemaining !== null && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999, background: freeRemaining > 0 ? T.primarySoft : T.roseSoft, color: freeRemaining > 0 ? T.primaryDeep : T.rose }}>
                      {freeRemaining}/{FREE_DAILY_LIMIT}
                    </span>
                  )}
                </div>
              </div>
              {/* 账户菜单：绑定邮箱 / 续费 / 退出登录 */}
              <button
                ref={menuAnchorRef}
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="账户菜单" aria-haspopup="menu" aria-expanded={menuOpen}
                title="账户设置"
                data-testid="account-menu-btn"
                style={{
                  width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                  border: `1px solid ${menuOpen ? T.primary : navBdr}`,
                  background: menuOpen ? T.primarySoft : "transparent",
                  color: menuOpen ? T.primary : t3,
                  cursor: "pointer", fontFamily: HOME_FONT, fontSize: 14, fontWeight: 800, lineHeight: 1, letterSpacing: 1,
                }}
              >···</button>
            </div>

            {/* 只有需要动作时才在卡上放按钮：免费→升级；Pro 快到期→续费；绑邮箱是账号安全提醒 */}
            {tier === "free" && (
              <button onClick={() => setUpgradeOpen(true)} style={{ width: "100%", marginTop: 10, padding: "7px 0", fontSize: 12, fontWeight: 700, border: "none", background: T.primary, color: "#fff", borderRadius: 8, cursor: "pointer", fontFamily: HOME_FONT }}>
                升级 Pro
              </button>
            )}
            {showRenewOnCard && (
              <button onClick={() => setUpgradeOpen(true)} style={{ width: "100%", marginTop: 10, padding: "7px 0", fontSize: 12, fontWeight: 700, border: `1px solid ${T.amber}`, background: T.amberSoft, color: T.amber, borderRadius: 8, cursor: "pointer", fontFamily: HOME_FONT }}>
                {proDaysLeft > 0 ? `Pro 还剩 ${proDaysLeft} 天 · 续费` : "Pro 已到期 · 续费"}
              </button>
            )}
            {isCodeUser && !email && (
              <button onClick={() => setBindEmailOpen(true)} style={{ width: "100%", marginTop: 8, padding: "6px 0", fontSize: 11, fontWeight: 600, border: `1px dashed ${T.primary}`, background: T.primarySoft, color: T.primaryDeep, borderRadius: 8, cursor: "pointer", fontFamily: HOME_FONT }}>
                ✉️ 绑定邮箱，防止账号丢失
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Entry list：反馈与交流 / 邀请 / 问卷（都是打开弹窗，不在侧栏内展开） ── */}
      <div style={{ padding: "8px 14px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        <SidebarActionItem
          emoji="💬" title="反馈与交流"
          sub={unseenReplies > 0 ? "作者回复了你的反馈" : "提反馈 · 微信群"}
          badge={unseenReplies > 0 ? String(unseenReplies) : ""}
          onClick={() => openSupport(unseenReplies > 0 ? "history" : "feedback")}
          navBdr={navBdr} navItemHover={navItemHover} t1={t1} t3={t3}
          testId="support-entry"
        />
        {onOpenReferral && (
          <SidebarActionItem
            emoji="🎁" title="邀请备考搭子" sub="每人 +3 天 Pro · 无上限"
            onClick={onOpenReferral}
            navBdr={navBdr} navItemHover={navItemHover} t1={t1} t3={t3}
          />
        )}
        {isLoggedIn && (
          <SidebarActionItem
            emoji="📝" title="题库体验问卷" sub="说说新题感受 · 得 +1 天 Pro"
            onClick={openFirstSetSurvey}
            navBdr={navBdr} navItemHover={navItemHover} t1={t1} t3={t3}
          />
        )}
      </div>
    </div>
  );
}
