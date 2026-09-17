"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { HOME_FONT, HOME_TOKENS as T } from "./theme";
import { FbStatusBadge } from "./sidebarWidgets";
import { WechatQrImage } from "../shared/WechatQrImage";

/**
 * 首页「反馈与交流」弹窗。
 *
 * 之前反馈表单 / 反馈历史 / 微信群二维码全是侧栏里的折叠区：侧栏本身 sticky 贴顶，
 * 折叠区一展开高度就超出视口，底部被裁掉又滚不到——用户反馈「反馈都看不见了」。
 * 现在三块内容统一收进这个弹窗，侧栏只留一个入口；页签切换，宽度够、字号能放大到可读。
 *
 * 状态（fbText/fbHistory 等）仍由 HomePageClient 持有，这里只负责渲染，
 * 所以移动端 BottomSheet 与桌面端共用同一套提交逻辑。
 */

export const SUPPORT_TABS = [
  { id: "feedback", label: "提交反馈" },
  { id: "history", label: "反馈记录" },
  { id: "wechat", label: "微信群" },
];

export const CONTACT_EMAIL = "3582786720@qq.com";

export function SupportModal({
  open, onClose, initialTab = "feedback",
  isLoggedIn, showLoginModal,
  fbText, setFbText, fbBusy, fbSent, feedbackMsg, submitFeedback,
  fbHistory = [], unseenReplies = 0, onHistoryViewed,
}) {
  const [tab, setTab] = useState(initialTab);

  // 每次打开都回到调用方指定的页签（例如点角标直达「反馈记录」）
  useEffect(() => { if (open) setTab(initialTab); }, [open, initialTab]);

  // 看过「反馈记录」即视为已读回复
  useEffect(() => { if (open && tab === "history") onHistoryViewed?.(); }, [open, tab, onHistoryViewed]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e) { if (e.key === "Escape") onClose?.(); }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const canSubmit = !!fbText?.trim() && !fbBusy && !fbSent;

  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label="反馈与交流"
      data-testid="support-modal"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(15,23,42,0.45)",
        WebkitBackdropFilter: "blur(5px)", backdropFilter: "blur(5px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, fontFamily: HOME_FONT,
      }}
    >
      <div style={{
        background: "#fff", width: "100%", maxWidth: 480,
        maxHeight: "min(88vh, 720px)", display: "flex", flexDirection: "column",
        borderRadius: 16, border: `1px solid ${T.bdr}`,
        boxShadow: "0 20px 50px rgba(15,23,42,0.22)", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", padding: "20px 22px 0" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: T.t1 }}>反馈与交流</div>
            <div style={{ fontSize: 12, color: T.t3, marginTop: 3 }}>遇到问题、想要的功能、或者想聊聊备考，都在这里。</div>
          </div>
          <button
            onClick={onClose} aria-label="关闭"
            style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 22, color: T.t3, lineHeight: 1, padding: "0 0 0 8px", fontFamily: HOME_FONT }}
          >×</button>
        </div>

        {/* Tabs */}
        <div role="tablist" style={{ display: "flex", gap: 4, padding: "14px 22px 0", borderBottom: `1px solid ${T.bdrSubtle}` }}>
          {SUPPORT_TABS.map((tb) => {
            const active = tb.id === tab;
            const badge = tb.id === "history" && unseenReplies > 0 ? unseenReplies : 0;
            return (
              <button
                key={tb.id} role="tab" aria-selected={active}
                onClick={() => setTab(tb.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "8px 12px 10px", background: "transparent", border: "none",
                  borderBottom: `2px solid ${active ? T.primary : "transparent"}`,
                  marginBottom: -1, cursor: "pointer", fontFamily: HOME_FONT,
                  fontSize: 13, fontWeight: active ? 700 : 600, color: active ? T.t1 : T.t3,
                }}
              >
                {tb.label}
                {badge > 0 && (
                  <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: T.indigo, borderRadius: 999, padding: "1px 6px" }}>{badge}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 22px 22px" }}>
          {tab === "feedback" && (
            !isLoggedIn ? (
              <div style={{ textAlign: "center", padding: "18px 0 6px" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.t1, marginBottom: 6 }}>登录后即可提交反馈</div>
                <div style={{ fontSize: 12, color: T.t3, lineHeight: 1.6, marginBottom: 14 }}>反馈会挂在你的账号下，作者回复后你能在「反馈记录」里看到。</div>
                <button onClick={() => { onClose?.(); showLoginModal?.(); }} style={{ padding: "9px 22px", borderRadius: 8, border: "none", background: T.primary, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: HOME_FONT }}>登录 / 注册</button>
                <div style={{ fontSize: 12, color: T.t3, marginTop: 16 }}>不想登录？也可以到「微信群」页签扫码直接找作者。</div>
              </div>
            ) : (
              <div>
                <textarea
                  value={fbText}
                  onChange={(e) => setFbText(e.target.value)}
                  placeholder="例如：某道听力题音频放不出来；希望增加某个功能……"
                  autoFocus
                  style={{
                    width: "100%", height: 130, resize: "vertical", boxSizing: "border-box",
                    border: `1px solid ${T.bdr}`, borderRadius: 10, padding: "10px 12px",
                    fontSize: 14, lineHeight: 1.6, color: T.t1, fontFamily: HOME_FONT, outline: "none",
                  }}
                />
                <button
                  onClick={submitFeedback}
                  disabled={!canSubmit}
                  style={{
                    width: "100%", marginTop: 10, padding: "10px 0", fontSize: 14, fontWeight: 700,
                    borderRadius: 10, border: "none", fontFamily: HOME_FONT,
                    cursor: canSubmit ? "pointer" : "default",
                    background: fbSent ? T.primarySoft : (canSubmit ? T.primary : T.bdrSubtle),
                    color: fbSent ? T.primary : (canSubmit ? "#fff" : T.t3),
                  }}
                >
                  {fbSent ? "已提交 ✓" : fbBusy ? "提交中..." : "提交反馈"}
                </button>
                {feedbackMsg && (
                  <div style={{ marginTop: 8, fontSize: 12, color: feedbackMsg.ok ? T.primary : T.rose }}>{feedbackMsg.text}</div>
                )}
                <div style={{ marginTop: 16, padding: "10px 12px", background: T.bgSoft, borderRadius: 10, fontSize: 12, color: T.t2, lineHeight: 1.7 }}>
                  作者会在「反馈记录」里回复，有新回复时首页侧栏会提示。
                  <br />着急的话也可以发邮件 <span style={{ color: T.t1, fontWeight: 600 }}>{CONTACT_EMAIL}</span>
                </div>
              </div>
            )
          )}

          {tab === "history" && (
            !isLoggedIn ? (
              <div style={{ textAlign: "center", padding: "24px 0", fontSize: 13, color: T.t3 }}>登录后可查看你的反馈与作者回复。</div>
            ) : fbHistory.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px 0", fontSize: 13, color: T.t3 }}>还没有反馈记录。</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {fbHistory.map((item) => (
                  <div key={item.id} style={{ border: `1px solid ${T.bdrSubtle}`, borderRadius: 10, padding: "10px 12px", background: "#fff" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: T.t3 }}>{formatDate(item.created_at)}</span>
                      <FbStatusBadge status={item.status} hasReply={!!item.admin_reply} />
                    </div>
                    <div style={{ fontSize: 13, color: T.t1, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{String(item.content || "")}</div>
                    {item.admin_reply && (
                      <div style={{ marginTop: 8, padding: "8px 10px", background: T.indigoSoft, borderRadius: 8, fontSize: 12, color: T.indigo, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        <b>作者回复：</b>{item.admin_reply}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          )}

          {tab === "wechat" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 13, color: T.t2, lineHeight: 1.6, marginBottom: 14, textAlign: "left" }}>
                扫码加入<strong style={{ color: T.t1 }}>用户交流群</strong>：反馈问题、领取更新通知，作者会在群里第一时间回复。
              </div>
              <div style={{ background: T.bgSoft, border: `1px solid ${T.bdrSubtle}`, borderRadius: 12, padding: 16, display: "flex", justifyContent: "center" }}>
                <WechatQrImage size={220} />
              </div>
              <div style={{ fontSize: 12, color: T.t3, marginTop: 10, lineHeight: 1.5 }}>点击图片放大，长按保存或用微信扫一扫</div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function formatDate(v) {
  try { return new Date(v).toLocaleDateString("zh-CN"); } catch { return ""; }
}
