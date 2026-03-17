"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { BottomSheet } from "../shared/BottomSheet";
import UpgradeModal from "../shared/UpgradeModal";
import { CHALLENGE_TOKENS as CH, HOME_FONT, HOME_TOKENS as T } from "./theme";
import { PRACTICE_MODE } from "../../lib/practiceMode";
import { FREE_DAILY_LIMIT } from "../../lib/dailyUsage";

/* ── 颜色工具 ── */
const mC = (isChallenge, light, dark) => (isChallenge ? dark : light);

/* ── 移动端首页（替代桌面的 sidebar+grid 布局） ── */
export function MobileHomePage({
  isChallenge, isPractice, mode, switchMode,
  gridItems, postWritingCounts,
  userCode, userTier, userEmail, isLoggedIn, showLoginModal, onLogout,
  totalCount, weekCount, bestMock,
  fbOpen, setFbOpen, fbText, setFbText, fbBusy, fbSent, feedbackMsg, submitFeedback,
  fadeIn, sideCard, querySuffix, isChallengeProp,
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const tier = userTier || "free";
  const [showDesktopTip, setShowDesktopTip] = useState(false);
  const desktopTipRef = useRef(false);

  useEffect(() => {
    try {
      if (localStorage.getItem("toefl-desktop-tip-dismissed") !== "1") setShowDesktopTip(true);
    } catch {}
  }, []);

  function dismissDesktopTip() {
    setShowDesktopTip(false);
    try { localStorage.setItem("toefl-desktop-tip-dismissed", "1"); } catch {}
  }

  const bg = isChallenge ? CH.bg : T.bg;
  const t1 = isChallenge ? CH.t1 : T.t1;
  const t2 = isChallenge ? CH.t2 : T.t2;

  return (
    <div style={{ padding: "16px 14px 80px", maxWidth: 520, margin: "0 auto" }}>

      {/* ── 电脑端推荐提示 ── */}
      {showDesktopTip && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 14px", marginBottom: 12,
          background: isChallenge ? "rgba(59,130,246,0.1)" : "#eff6ff",
          border: `1px solid ${isChallenge ? "rgba(59,130,246,0.25)" : "#bfdbfe"}`,
          borderRadius: 10, fontSize: 12, color: isChallenge ? "#93c5fd" : "#1e40af", lineHeight: 1.5,
        }}>
          <span style={{ flexShrink: 0, fontSize: 15 }}>💻</span>
          <div style={{ flex: 1 }}>推荐使用电脑访问本工具，体验更好</div>
          <button
            onClick={dismissDesktopTip}
            style={{ flexShrink: 0, background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 14, fontWeight: 700, padding: "0 4px", lineHeight: 1, touchAction: "manipulation" }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── 用户状态条 ── */}
      <div
        onClick={() => isLoggedIn ? setSheetOpen(true) : showLoginModal()}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px", marginBottom: 16,
          background: isChallenge ? CH.card : T.card,
          border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`,
          borderRadius: 12, cursor: "pointer",
        }}
      >
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: "linear-gradient(135deg,#087355,#0891B2)",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <span style={{ color: "#fff", fontSize: 16, fontWeight: 800 }}>
            {isLoggedIn ? (userEmail ? userEmail[0].toUpperCase() : "U") : "?"}
          </span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: t1 }}>
            {isLoggedIn ? (userEmail || `用户 ${userCode?.slice(0, 3)}...`) : "未登录"}
          </div>
          <div style={{ fontSize: 11, color: t2 }}>
            {isLoggedIn
              ? (tier === "pro" ? "Pro 会员" : tier === "legacy" ? "Legacy · 不限次" : `免费版 · 每日 ${FREE_DAILY_LIMIT} 次`)
              : "点击登录，保存练习记录"}
          </div>
        </div>
        {isLoggedIn && (
          <div style={{ display: "flex", gap: 12, fontSize: 11, color: t2, flexShrink: 0 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: T.primary }}>{totalCount || 0}</div>
              <div>总练习</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: T.cyan }}>{weekCount}</div>
              <div>本周</div>
            </div>
          </div>
        )}
        <span style={{ color: t2, fontSize: 18 }}>›</span>
      </div>

      {/* ── 标题 + 模式切换 ── */}
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ margin: "0 0 10px", fontSize: 22, fontWeight: 800, color: t1, lineHeight: 1.2 }}>
          {isChallenge
            ? <>写作练习 <span style={{ color: CH.accent }}>Challenge</span></>
            : isPractice
              ? <>写作练习 <span style={{ color: "#6366f1" }}>Practice</span></>
              : "英语写作练习"}
        </h1>
        <div style={{
          display: "flex", gap: 0,
          background: isChallenge ? "rgba(255,255,255,0.05)" : T.card,
          border: `1px solid ${isChallenge ? "rgba(255,30,30,0.3)" : T.bdr}`,
          borderRadius: 10, overflow: "hidden",
        }}>
          {[
            { value: PRACTICE_MODE.STANDARD, label: "Standard" },
            { value: PRACTICE_MODE.PRACTICE, label: "Practice" },
            { value: PRACTICE_MODE.CHALLENGE, label: "Challenge" },
          ].map((opt) => {
            const sel = mode === opt.value;
            const chOpt = opt.value === PRACTICE_MODE.CHALLENGE;
            const prOpt = opt.value === PRACTICE_MODE.PRACTICE;
            return (
              <button
                key={opt.value}
                onClick={() => switchMode(opt.value)}
                style={{
                  flex: 1, border: "none", padding: "10px 0", fontSize: 13, fontWeight: 700,
                  cursor: "pointer", fontFamily: HOME_FONT, transition: "all .15s",
                  background: sel
                    ? (chOpt ? "rgba(255,30,30,0.15)" : prOpt ? "rgba(99,102,241,0.1)" : T.primary + "18")
                    : "transparent",
                  color: sel
                    ? (chOpt ? CH.accent : prOpt ? "#6366f1" : T.primary)
                    : t2,
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 任务卡片列表 ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        {gridItems.map((item) => (
          <MobileTaskCard key={item.k} item={item} isChallenge={isChallenge} />
        ))}
      </div>

      {/* ── 写后练习入口 ── */}
      {postWritingCounts.total > 0 && (
        <Link
          href={`/post-writing-practice${querySuffix}`}
          style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "14px 16px", marginBottom: 14,
            background: isChallenge ? CH.card : T.card,
            border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`,
            borderRadius: 12, textDecoration: "none", color: "inherit",
          }}
        >
          <span style={{ fontSize: 20 }}>Aa</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t1 }}>拼写填空练习</div>
            <div style={{ fontSize: 12, color: t2 }}>
              今日 {postWritingCounts.today} 题，错题本 {postWritingCounts.notebook} 题
            </div>
          </div>
          <span style={{ color: t2 }}>›</span>
        </Link>
      )}

      {/* ── 底部快捷入口 ── */}
      <div style={{ display: "flex", gap: 8 }}>
        <Link href={`/progress${querySuffix}`} style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          padding: "12px 0", borderRadius: 10, textDecoration: "none",
          background: isChallenge ? CH.card : T.card,
          border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`,
          fontSize: 13, fontWeight: 600, color: t2,
        }}>
          📈 练习记录
        </Link>
        <button onClick={() => setSheetOpen(true)} style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          padding: "12px 0", borderRadius: 10, cursor: "pointer",
          background: isChallenge ? CH.card : T.card,
          border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`,
          fontSize: 13, fontWeight: 600, color: t2, fontFamily: HOME_FONT,
        }}>
          💬 反馈
        </button>
      </div>

      {/* ── 用户信息底部弹出 ── */}
      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="账户与反馈">
        <MobileUserSheetContent
          userCode={userCode} userTier={tier} userEmail={userEmail}
          isLoggedIn={isLoggedIn} onLogout={onLogout}
          totalCount={totalCount} weekCount={weekCount} bestMock={bestMock}
          fbText={fbText} setFbText={setFbText}
          fbBusy={fbBusy} fbSent={fbSent} feedbackMsg={feedbackMsg}
          submitFeedback={submitFeedback}
          showLoginModal={showLoginModal}
          isChallenge={isChallenge}
          onUpgrade={() => { setSheetOpen(false); setUpgradeOpen(true); }}
        />
      </BottomSheet>

      {upgradeOpen && (
        <UpgradeModal
          userCode={userCode}
          currentTier={tier}
          onClose={() => setUpgradeOpen(false)}
          onUpgraded={() => window.location.reload()}
        />
      )}
    </div>
  );
}

/* ── 移动端任务卡片 ── */
function MobileTaskCard({ item, isChallenge }) {
  const { href, acc, n, t, d, it, timeLabel, isMock } = item;
  const t1 = isChallenge ? CH.t1 : T.t1;
  const t2 = isChallenge ? CH.t2 : T.t2;

  return (
    <Link
      href={href}
      style={{
        display: "flex", alignItems: "stretch",
        background: isChallenge ? (isMock ? "linear-gradient(180deg,#14101c,#1a0e16)" : CH.card) : (isMock ? T.primarySoft : T.card),
        border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`,
        borderRadius: 14, overflow: "hidden",
        textDecoration: "none", color: "inherit",
        minHeight: 72,
      }}
    >
      {/* 左侧时间标签 */}
      <div style={{
        width: 64, minWidth: 64, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        background: isChallenge ? CH.timeBg : (isMock ? `${T.primary}18` : acc.soft),
        padding: "8px 4px",
      }}>
        <div style={{
          fontSize: 15, fontWeight: 800,
          color: isChallenge ? CH.accent : acc.color,
          whiteSpace: "nowrap",
        }}>
          {timeLabel}
        </div>
      </div>

      {/* 分隔线 */}
      <div style={{ width: 1, background: isChallenge ? CH.cardBorder : `${acc.color}30` }} />

      {/* 内容区 */}
      <div style={{ flex: 1, padding: "12px 14px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: isChallenge ? CH.accent : acc.color, marginBottom: 2 }}>{n}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: t1, marginBottom: 2, lineHeight: 1.3 }}>{t}</div>
        <div style={{ fontSize: 12, color: t2, lineHeight: 1.4 }}>{d}</div>
      </div>

      {/* 右箭头 */}
      <div style={{
        display: "flex", alignItems: "center", padding: "0 14px",
        color: isChallenge ? CH.accent : acc.color, fontSize: 18,
      }}>
        ›
      </div>
    </Link>
  );
}

/* ── 底部弹出面板内容 ── */
function MobileUserSheetContent({
  userCode, userTier, userEmail, isLoggedIn, onLogout,
  totalCount, weekCount, bestMock,
  fbText, setFbText, fbBusy, fbSent, feedbackMsg, submitFeedback,
  showLoginModal, isChallenge, onUpgrade,
}) {
  const [showCode, setShowCode] = useState(false);

  if (!isLoggedIn) {
    return (
      <div style={{ textAlign: "center", padding: "20px 0" }}>
        <div style={{ fontSize: 14, color: "#5a6b62", marginBottom: 16 }}>
          登录后可保存练习记录、同步进度
        </div>
        <button
          onClick={showLoginModal}
          style={{
            width: "100%", padding: "12px 0", fontSize: 15, fontWeight: 700,
            border: "none", background: T.primary, color: "#fff",
            borderRadius: 10, cursor: "pointer", fontFamily: HOME_FONT,
          }}
        >
          登录 / 注册
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* 用户信息 */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "14px", background: "#f8faf9", borderRadius: 12,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: "linear-gradient(135deg,#087355,#0891B2)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ color: "#fff", fontSize: 20, fontWeight: 800 }}>
            {userEmail ? userEmail[0].toUpperCase() : "U"}
          </span>
        </div>
        <div style={{ flex: 1 }}>
          {userEmail && <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2420" }}>{userEmail}</div>}
          <div style={{ fontSize: 12, color: "#5a6b62" }}>
            {userTier === "pro" ? "Pro 会员" : userTier === "legacy" ? "Legacy · 不限次" : "免费版"}
          </div>
        </div>
        {(userTier === "free" || userTier === "pro") && (
          <button onClick={onUpgrade} style={{
            fontSize: 12, fontWeight: 700, color: T.primary,
            padding: "6px 12px", borderRadius: 8,
            background: T.primarySoft, border: `1px solid ${T.primaryMist}`,
            cursor: "pointer", fontFamily: HOME_FONT,
          }}>
            {userTier === "pro" ? "续费" : "升级 Pro"}
          </button>
        )}
      </div>

      {/* 统计数据 */}
      <div style={{ display: "flex", gap: 8 }}>
        {[
          { label: "总练习", value: totalCount || 0, color: T.primary },
          { label: "本周", value: weekCount, color: T.cyan },
          { label: "最高模考", value: bestMock !== null ? bestMock.toFixed(1) : "-", color: T.amber },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            flex: 1, textAlign: "center", padding: "10px 0",
            background: "#f8faf9", borderRadius: 10,
          }}>
            <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
            <div style={{ fontSize: 11, color: "#5a6b62" }}>{label}</div>
          </div>
        ))}
      </div>

      {/* 登录码 */}
      {userCode && (
        <div style={{ padding: "12px 14px", background: "#f8faf9", borderRadius: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#94a39a", textTransform: "uppercase", marginBottom: 6 }}>登录码</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              fontSize: 18, fontWeight: 800, fontFamily: "monospace", letterSpacing: 2,
              filter: showCode ? "none" : "blur(5px)", transition: "filter .2s",
            }}>
              {userCode}
            </span>
            <button
              onClick={() => setShowCode((v) => !v)}
              style={{ border: "none", background: "none", fontSize: 14, cursor: "pointer", padding: 4 }}
            >
              {showCode ? "🙈" : "👁"}
            </button>
          </div>
        </div>
      )}

      {/* 反馈表单 */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1a2420", marginBottom: 8 }}>反馈</div>
        <textarea
          value={fbText}
          onChange={(e) => setFbText(e.target.value)}
          placeholder="遇到问题或有建议？请告诉我们。"
          style={{
            width: "100%", height: 80, resize: "none",
            border: "1px solid #dde5df", borderRadius: 10,
            padding: "10px 12px", fontSize: 14, lineHeight: 1.5,
            fontFamily: HOME_FONT, outline: "none", boxSizing: "border-box",
          }}
        />
        <button
          onClick={submitFeedback}
          disabled={!fbText?.trim() || fbBusy || fbSent}
          style={{
            width: "100%", marginTop: 8, padding: "10px 0",
            fontSize: 14, fontWeight: 700, borderRadius: 10,
            border: "none", cursor: "pointer", fontFamily: HOME_FONT,
            background: fbSent ? T.primarySoft : (fbText?.trim() ? T.primary : "#e5e7eb"),
            color: fbSent ? T.primary : (fbText?.trim() ? "#fff" : "#9ca3af"),
          }}
        >
          {fbSent ? "已提交" : fbBusy ? "提交中..." : "提交反馈"}
        </button>
        {feedbackMsg && (
          <div style={{ marginTop: 6, fontSize: 12, color: feedbackMsg.ok ? T.primary : "#dc2626" }}>
            {feedbackMsg.text}
          </div>
        )}
      </div>

      {/* 联系作者 */}
      <div style={{ padding: "12px 14px", background: "#f8faf9", borderRadius: 10, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#1a2420" }}>联系作者</span>
        <span style={{ fontSize: 12, color: "#5a6b62", flex: 1 }}>3582786720@qq.com</span>
      </div>

      {/* 退出按钮 */}
      <button
        onClick={onLogout}
        style={{
          width: "100%", padding: "12px 0", fontSize: 14, fontWeight: 600,
          border: "1px solid #fee2e2", background: "#fff5f5", color: "#dc2626",
          borderRadius: 10, cursor: "pointer", fontFamily: HOME_FONT,
        }}
      >
        退出登录
      </button>
    </div>
  );
}
