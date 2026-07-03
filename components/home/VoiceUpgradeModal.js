"use client";
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { C, FONT } from "../shared/ui";

// "听力语音，惊喜升级" — a one-shot A/B试听 + 投票 campaign modal.
//
// Presentational only: the trigger owns gating/persistence and passes the two
// audio URLs in via `sample`. Two states: the vote view, then a thank-you view.
//
// Props:
//   open      — controls visibility
//   sample    — { transcript, voiceA:{label,url}, voiceB:{label,url} }
//   onVote    — (choice: "upgrade" | "keep") => Promise|void
//   onDismiss — () => void  (× / 维持现状-after-thanks / closed without voting)
export function VoiceUpgradeModal({ open, sample, onVote, onDismiss }) {
  const [voted, setVoted] = useState("");   // "" | "upgrade" | "keep"
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) { setVoted(""); setSubmitting(false); }
  }, [open]);

  if (!open || !sample) return null;

  async function handleVote(choice) {
    if (submitting || voted) return;
    setSubmitting(true);
    try {
      await onVote?.(choice);
      setVoted(choice);
    } catch {
      // best-effort: still flip to the thank-you state so the user isn't stuck.
      setVoted(choice);
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div
      data-tp-overlay
      role="dialog"
      aria-modal="true"
      aria-label="听力语音升级投票"
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(15,23,42,0.55)",
        WebkitBackdropFilter: "blur(6px)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, fontFamily: FONT,
      }}
    >
      <div
        style={{
          background: "#fff",
          width: "100%", maxWidth: 460,
          maxHeight: "90vh", overflowY: "auto",
          borderRadius: 16,
          border: `1px solid ${C.bdr}`,
          boxShadow: "0 20px 50px rgba(15,23,42,0.25)",
        }}
      >
        {/* header band */}
        <div
          style={{
            position: "relative",
            background: C.softAmber,
            borderBottom: `1px solid ${C.bdr}`,
            borderRadius: "16px 16px 0 0",
            padding: "18px 22px",
          }}
        >
          <button
            onClick={() => onDismiss?.()}
            aria-label="关闭"
            style={{
              position: "absolute", top: 12, right: 14,
              background: "transparent", border: "none", cursor: "pointer",
              fontSize: 22, color: C.t3, lineHeight: 1, padding: 4,
            }}
          >
            ×
          </button>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.t1 }}>
            🎉 听力语音，惊喜升级！
          </div>
          <div style={{ fontSize: 12.5, color: C.orange, fontWeight: 600, marginTop: 3 }}>
            试听 A / B，投一票决定要不要上
          </div>
        </div>

        <div style={{ padding: 22 }}>
          {!voted ? (
            <>
              <p style={{ fontSize: 13.5, color: C.t2, lineHeight: 1.7, margin: "0 0 14px" }}>
                不少同学反馈：现在的听力语音（测试版）有点“机器味”。事实上，根本原因是<b style={{ color: C.t1 }}>成本</b>——更高的拟真度意味着使用更贵的模型。
                <br /><br />
                我们打算升级到 <b style={{ color: C.t1 }}>GPT-4o 级别</b>的新语音引擎，听感明显更接近真人。当然，更强的技术也意味着更高成本，<b style={{ color: C.t1 }}>未来定价会相应调整</b>（目前听力、阅读、口语三个题型都还在测试期间）。
                <br /><br />
                先听两段<b style={{ color: C.t1 }}>同一段对话</b>的对比（同一批人、只换语音引擎），再投一票告诉我们：值不值得升级？
              </p>

              <AudioCard tag="A" {...sample.voiceA} accent={C.t3} />
              <div style={{ height: 10 }} />
              <AudioCard tag="B" {...sample.voiceB} accent={C.blue} highlight />

              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 18 }}>
                <VoteButton
                  primary
                  disabled={submitting}
                  onClick={() => handleVote("upgrade")}
                >
                  👍 B 明显更好，支持升级
                </VoteButton>
                <VoteButton
                  disabled={submitting}
                  onClick={() => handleVote("keep")}
                >
                  🤔 差不多，维持现状就好
                </VoteButton>
              </div>

              <div style={{ fontSize: 11.5, color: C.t3, marginTop: 12, textAlign: "center" }}>
                你的选择会进入后台统计，真实影响我们的决定。
              </div>
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "8px 4px 4px" }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>🌱</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.t1, marginBottom: 6 }}>
                收到，谢谢你的一票！
              </div>
              <div style={{ fontSize: 13, color: C.t2, lineHeight: 1.65, marginBottom: 18 }}>
                {voted === "upgrade"
                  ? "我们会根据大家的反馈推进语音升级，并同步公布定价方案。"
                  : "我们会综合大家的意见，谨慎决定升级与定价的节奏。"}
              </div>
              <VoteButton primary onClick={() => onDismiss?.()}>
                好的
              </VoteButton>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function AudioCard({ tag, label, url, accent, highlight }) {
  return (
    <div
      style={{
        border: `1px solid ${highlight ? C.blue : C.bdr}`,
        background: highlight ? C.ltB : "#fff",
        borderRadius: 12,
        padding: "11px 13px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 22, height: 22, borderRadius: 6,
            background: accent, color: "#fff", fontSize: 12.5, fontWeight: 800,
          }}
        >
          {tag}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.t1 }}>
          语音 {tag}
          <span style={{ color: C.t2, fontWeight: 400, marginLeft: 6 }}>· {label}</span>
        </span>
      </div>
      <audio
        controls
        preload="none"
        src={url}
        style={{ width: "100%", height: 36, display: "block" }}
      />
    </div>
  );
}

function VoteButton({ children, onClick, disabled, primary }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      type="button"
      style={{
        width: "100%",
        padding: "11px 14px",
        borderRadius: 10,
        border: primary ? "none" : `1px solid ${C.bdr}`,
        background: primary ? C.blue : "#fff",
        color: primary ? "#fff" : C.t1,
        fontSize: 14, fontWeight: 700, fontFamily: FONT,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "opacity 120ms ease, background 120ms ease",
      }}
    >
      {children}
    </button>
  );
}
