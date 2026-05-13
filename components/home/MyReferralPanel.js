"use client";

import { useEffect, useState } from "react";
import { HOME_FONT, HOME_TOKENS as T } from "./theme";
import { trackReferralEvent } from "../../lib/analytics/referral";

const REWARD_DAYS = 3;
const MAX_REWARDS = 30;

function buildShareText(link, code) {
  // Strip protocol for a cleaner inline link in WeChat/朋友圈 shares
  const cleanLink = String(link || "").replace(/^https?:\/\//, "");
  return `我在 TreePractice 练托福写作，AI 给批改打分挺靠谱。用我的邀请码 ${code} 注册有 3 天 Pro 试用，链接：${cleanLink}`;
}

async function copy(text) {
  if (!text) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // Fallback for older mobile browsers
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Reusable referral panel — shows stats, referral link, share text, and copy buttons.
 * Renders nothing if the user isn't logged in (parent should handle that gate).
 *
 * Props:
 *  - userCode: string — the inviter's 6-char code
 *  - compact: boolean — tighter padding for sidebar use
 */
export function MyReferralPanel({ userCode, compact = false }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedText, setCopiedText] = useState(false);

  useEffect(() => {
    if (!userCode) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/referral/stats?code=${encodeURIComponent(userCode)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.ok) setStats(data);
      })
      .catch(() => { /* leave stats null */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userCode]);

  if (!userCode) return null;

  const origin = typeof window !== "undefined" ? window.location.origin : "https://treepractice.com";
  const link = `${origin}/?ref=${userCode}`;
  const shareText = buildShareText(link, userCode);

  const grantedCount = stats?.grantedCount ?? 0;
  const pendingCount = stats?.pendingCount ?? 0;
  const daysEarned = stats?.daysEarned ?? 0;
  const daysRemaining = stats?.daysRemaining ?? MAX_REWARDS;

  const pad = compact ? "12px 14px" : "16px 18px";

  async function handleCopyLink() {
    const ok = await copy(link);
    if (ok) {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
      trackReferralEvent("share_link_copied", { inviterCode: userCode });
    }
  }

  async function handleCopyText() {
    const ok = await copy(shareText);
    if (ok) {
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2000);
      trackReferralEvent("share_text_copied", { inviterCode: userCode });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, fontFamily: HOME_FONT }}>
      {/* How it works */}
      <div style={{
        padding: pad,
        background: "linear-gradient(135deg, #ecfdf5 0%, #ecfeff 100%)",
        border: "1px solid rgba(13,150,104,0.18)",
        borderRadius: 10,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#065f46", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 14 }}>🎁</span>
          活动规则
        </div>
        <div style={{ fontSize: 11, color: "#0e7c66", lineHeight: 1.7 }}>
          1. 把你的邀请链接 / 邀请码分享给好友<br />
          2. 好友用邀请码注册（注册即送 3 天 Pro 试用）<br />
          3. 好友完成一次练习后，<strong style={{ color: T.primary }}>你获得 +{REWARD_DAYS} 天 Pro</strong><br />
          4. 最多可累计获得 {MAX_REWARDS} 天
        </div>
      </div>

      {/* Stats */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 6,
      }}>
        {[
          { label: "已获得", value: loading ? "…" : `${daysEarned} 天`, color: T.primary },
          { label: "成功邀请", value: loading ? "…" : `${grantedCount} 人`, color: T.cyan },
          { label: "邀请中", value: loading ? "…" : `${pendingCount} 人`, color: T.amber },
        ].map((s) => (
          <div key={s.label} style={{
            padding: "10px 8px",
            background: "#f8faf9",
            border: `1px solid ${T.bdrSubtle}`,
            borderRadius: 8,
            textAlign: "center",
          }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: s.color, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
            <div style={{ fontSize: 10, color: T.t3, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Remaining cap hint */}
      {!loading && grantedCount > 0 && daysRemaining > 0 && (
        <div style={{ fontSize: 11, color: T.t3, textAlign: "center" }}>
          还可累计获得 {daysRemaining} 天
        </div>
      )}
      {!loading && daysRemaining === 0 && (
        <div style={{ fontSize: 11, color: T.amber, textAlign: "center", fontWeight: 600 }}>
          🎉 已达 {MAX_REWARDS} 天上限
        </div>
      )}

      {/* Referral link */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.t3, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.5 }}>
          邀请链接
        </div>
        <div style={{
          display: "flex",
          alignItems: "stretch",
          border: `1px solid ${T.bdr}`,
          borderRadius: 8,
          overflow: "hidden",
          background: "#fff",
        }}>
          <input
            readOnly
            value={link}
            onClick={(e) => e.currentTarget.select()}
            style={{
              flex: 1,
              minWidth: 0,
              padding: "9px 10px",
              fontSize: 12,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', monospace",
              color: T.t1,
              border: "none",
              outline: "none",
              background: "transparent",
            }}
          />
          <button
            onClick={handleCopyLink}
            style={{
              flexShrink: 0,
              padding: "0 14px",
              border: "none",
              background: copiedLink ? T.primarySoft : T.primary,
              color: copiedLink ? T.primary : "#fff",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: HOME_FONT,
              transition: "all 0.15s",
              minWidth: 64,
            }}
          >
            {copiedLink ? "已复制" : "复制"}
          </button>
        </div>
      </div>

      {/* Share text */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.t3, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.5 }}>
          一键复制朋友圈 / 微信文案
        </div>
        <div style={{
          padding: "10px 12px",
          background: "#f8faf9",
          border: `1px solid ${T.bdrSubtle}`,
          borderRadius: 8,
          fontSize: 12,
          color: T.t2,
          lineHeight: 1.7,
          whiteSpace: "pre-wrap",
          marginBottom: 6,
        }}>
          {shareText}
        </div>
        <button
          onClick={handleCopyText}
          style={{
            width: "100%",
            padding: "9px 0",
            border: "none",
            background: copiedText ? T.primarySoft : "linear-gradient(135deg, #087355, #0891B2)",
            color: copiedText ? T.primary : "#fff",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            borderRadius: 8,
            fontFamily: HOME_FONT,
            transition: "all 0.15s",
          }}
        >
          {copiedText ? "✓ 已复制文案" : "复制文案"}
        </button>
      </div>

      {/* Footnote */}
      <div style={{ fontSize: 10, color: T.t3, lineHeight: 1.6, paddingTop: 4 }}>
        奖励将在好友完成首次练习后自动到账。同 IP 24 小时内只能绑定一次邀请关系，超过上限将不再发放。
      </div>
    </div>
  );
}
