"use client";

import { CHALLENGE_TOKENS as CH, HOME_FONT, HOME_TOKENS as T } from "./theme";

function sectionTitle(isChallenge) {
  return {
    fontSize: 11,
    fontWeight: 700,
    color: isChallenge ? CH.t2 : T.t3,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: 10,
  };
}

function FbStatusBadge({ status, hasReply }) {
  if (hasReply) return <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: "#eff6ff", color: "#1d4ed8" }}>已回复</span>;
  if (status === "resolved") return <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: "#f0fdf4", color: "#15803d" }}>已修改</span>;
  return <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: "#f8fafc", color: "#64748b" }}>处理中</span>;
}

export function HomeSidebar({
  userCode,
  onLogout,
  totalCount,
  weekCount,
  bestMock,
  isChallenge,
  copied,
  copyCode,
  logoutHover,
  setLogoutHover,
  fbOpen,
  setFbOpen,
  fbText,
  setFbText,
  fbBusy,
  fbSent,
  feedbackMsg,
  submitFeedback,
  fbHistory,
  fbHistLoading,
  sideCard,
  fadeIn,
}) {
  return (
    <div className="home-sidebar" style={{ width: 240, minWidth: 240, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10, position: "sticky", top: 80, alignSelf: "flex-start" }}>
      <div style={{ ...sideCard({ padding: "20px 18px" }), ...fadeIn(100) }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#087355,#0891B2)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14, flexShrink: 0 }}>
          <span style={{ color: "#fff", fontSize: 20, fontWeight: 800 }}>T</span>
        </div>
        <div style={sectionTitle(isChallenge)}>登录码</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: isChallenge ? CH.t1 : T.t1, fontVariantNumeric: "tabular-nums", letterSpacing: "0.05em", fontFamily: "monospace" }}>
            {userCode || "-"}
          </span>
          {userCode ? <button onClick={copyCode} style={{ border: `1px solid ${copied ? T.primary : (isChallenge ? CH.cardBorder : T.bdr)}`, background: copied ? T.primarySoft : (isChallenge ? "rgba(255,255,255,0.05)" : T.bg), color: copied ? T.primary : (isChallenge ? CH.t2 : T.t2), borderRadius: 6, padding: "2px 7px", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all .15s", fontFamily: HOME_FONT }}>{copied ? "已复制" : "复制"}</button> : null}
        </div>
        <div style={{ fontSize: 11, color: isChallenge ? CH.t2 : T.t3, lineHeight: 1.5, marginBottom: 14 }}>
          请妥善保存登录码，以便同步你的登录状态和练习记录。
        </div>
        <button onClick={onLogout} onMouseEnter={() => setLogoutHover(true)} onMouseLeave={() => setLogoutHover(false)} style={{ width: "100%", padding: "8px 0", fontSize: 12, fontWeight: 600, border: `1px solid ${logoutHover ? T.rose : (isChallenge ? CH.cardBorder : T.bdr)}`, color: logoutHover ? T.rose : (isChallenge ? CH.t2 : T.t2), background: logoutHover ? T.roseSoft : "transparent", borderRadius: 8, cursor: "pointer", transition: "all .15s", fontFamily: HOME_FONT }}>
          退出登录
        </button>
      </div>

      <div style={{ ...sideCard({}), ...fadeIn(180) }}>
        <button onClick={() => setFbOpen((v) => !v)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "14px 18px", background: "transparent", border: "none", cursor: "pointer", fontFamily: HOME_FONT, textAlign: "left" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: isChallenge ? CH.t1 : T.t1, flex: 1 }}>反馈窗口</span>
          <span style={{ fontSize: 11, color: isChallenge ? CH.t2 : T.t3, display: "inline-block", transform: fbOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.25s ease" }}>v</span>
        </button>
        <div style={{ maxHeight: fbOpen ? 600 : 0, overflow: "hidden", transition: "max-height 0.35s cubic-bezier(0.25,1,0.5,1)" }}>
          <div style={{ padding: "0 18px 16px" }}>
            <textarea value={fbText} onChange={(e) => setFbText(e.target.value)} placeholder="请填写你觉得不清楚、异常或缺失的地方。" style={{ width: "100%", height: 88, resize: "none", background: isChallenge ? "rgba(255,255,255,0.04)" : T.bg, border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`, borderRadius: 8, padding: "8px 10px", fontSize: 12, lineHeight: 1.5, color: isChallenge ? CH.t1 : T.t1, fontFamily: HOME_FONT, outline: "none", boxSizing: "border-box" }} />
            <button onClick={submitFeedback} disabled={!fbText.trim() || fbBusy || fbSent} style={{ width: "100%", marginTop: 8, padding: "8px 0", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", cursor: fbText.trim() && !fbBusy && !fbSent ? "pointer" : "default", background: fbSent ? T.primarySoft : (fbText.trim() ? T.primary : (isChallenge ? "rgba(255,255,255,0.07)" : T.bg)), color: fbSent ? T.primary : (fbText.trim() ? "#fff" : (isChallenge ? CH.t2 : T.t3)), transition: "all .15s", fontFamily: HOME_FONT }}>
              {fbSent ? "已提交" : fbBusy ? "提交中..." : "提交"}
            </button>
            {feedbackMsg ? <div style={{ marginTop: 8, fontSize: 11, color: feedbackMsg.ok ? T.primary : T.rose }}>{feedbackMsg.text}</div> : null}

            {/* History */}
            {(fbHistLoading || fbHistory.length > 0) && (
              <div style={{ marginTop: 14, borderTop: `1px solid ${isChallenge ? CH.cardBorder : T.bdrSubtle}`, paddingTop: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: isChallenge ? CH.t2 : T.t3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>历史反馈</div>
                {fbHistLoading ? (
                  <div style={{ fontSize: 11, color: isChallenge ? CH.t2 : T.t3 }}>加载中...</div>
                ) : fbHistory.map((item) => (
                  <div key={item.id} style={{ marginBottom: 10, background: isChallenge ? "rgba(255,255,255,0.04)" : T.bg, borderRadius: 8, padding: "8px 10px", border: `1px solid ${isChallenge ? CH.cardBorder : T.bdrSubtle}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: isChallenge ? CH.t2 : T.t3 }}>{new Date(item.created_at).toLocaleDateString("zh-CN")}</span>
                      <FbStatusBadge status={item.status} hasReply={!!item.admin_reply} />
                    </div>
                    <div style={{ fontSize: 11, color: isChallenge ? CH.t1 : T.t2, lineHeight: 1.5 }}>{String(item.content || "").slice(0, 80)}{item.content?.length > 80 ? "…" : ""}</div>
                    {item.admin_reply && (
                      <div style={{ marginTop: 6, padding: "6px 8px", background: isChallenge ? "rgba(99,102,241,0.12)" : "#eff6ff", borderRadius: 6, fontSize: 11, color: isChallenge ? "#a5b4fc" : "#1d4ed8", lineHeight: 1.5 }}>
                        <b>管理员回复：</b>{item.admin_reply}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ ...sideCard({ padding: "16px 18px" }), ...fadeIn(260) }}>
        <div style={sectionTitle(isChallenge)}>概览</div>
        {[
          { label: "总练习数", value: totalCount > 0 ? String(totalCount) : "-", color: T.primary },
          { label: "近 7 天", value: String(weekCount), color: T.cyan },
          { label: "最高模考", value: bestMock !== null ? `${bestMock.toFixed(1)}` : "-", color: T.amber },
        ].map(({ label, value, color }, index) => (
          <div key={label}>
            {index > 0 ? <div style={{ height: 1, background: isChallenge ? CH.cardBorder : T.bdrSubtle, margin: "9px 0" }} /> : null}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: isChallenge ? CH.t2 : T.t2 }}>{label}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: isChallenge ? CH.t1 : color, fontVariantNumeric: "tabular-nums" }}>{value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
