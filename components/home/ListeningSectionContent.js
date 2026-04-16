"use client";

import { useState, useEffect } from "react";
import { SECTION_ACCENTS } from "./sections";
import { CHALLENGE_TOKENS as CH, HOME_FONT, HOME_TOKENS as T } from "./theme";
import { PRACTICE_MODE } from "../../lib/practiceMode";
import { HomeTaskCard, HomeLinkCard } from "./HomeTaskCard";
import { loadHist } from "../../lib/sessionStore";

const LISTENING_ACCENT = SECTION_ACCENTS.listening;

const LISTENING_TASKS = [
  {
    k: "listening-lcr",
    n: "Task 1",
    t: "Choose a Response",
    d: "听一句话，选最合适的回应。",
    it: "10 questions",
    timeLabel: "5 min",
  },
  {
    k: "listening-la",
    n: "Task 2",
    t: "Announcement",
    d: "听校园公告并回答理解题。",
    it: "2-3 questions",
    timeLabel: "3 min",
  },
  {
    k: "listening-lc",
    n: "Task 3",
    t: "Conversation",
    d: "听一段校园对话并回答问题。",
    it: "2 questions",
    timeLabel: "5 min",
  },
  {
    k: "listening-lat",
    n: "Task 4",
    t: "Academic Talk",
    d: "听学术讲座并回答理解题。",
    it: "3-5 questions",
    timeLabel: "8 min",
  },
];

export function ListeningSectionContent({
  isChallenge, isPractice, mode, switchMode,
  hoverKey, setHoverKey, fadeIn,
  userTier, isLoggedIn, showLoginModal,
}) {
  const isPro = userTier === "pro" || userTier === "legacy";
  const modeStr = isPractice ? "practice" : mode === PRACTICE_MODE.CHALLENGE ? "challenge" : "standard";

  const gridItems = LISTENING_TASKS.map((task, index) => {
    const typeMap = {
      "listening-lcr": "lcr",
      "listening-la": "la",
      "listening-lc": "lc",
      "listening-lat": "lat",
    };
    return {
      k: task.k,
      href: `/listening?type=${typeMap[task.k]}&mode=${modeStr}`,
      acc: LISTENING_ACCENT,
      n: task.n,
      t: task.t,
      d: isPractice ? "自选题目，不限时间。" : task.d,
      it: task.it,
      timeLabel: isPractice ? "不限时" : task.timeLabel,
      isMock: false,
      delay: 190 + index * 70,
    };
  });

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {/* Section header + mode switcher */}
      <div style={{ marginBottom: 16, ...fadeIn(50) }}>
        <div className="tp-home-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 10 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: isChallenge ? CH.t1 : T.t1, letterSpacing: -0.5, lineHeight: 1.2 }}>
            Listening
            <span style={{ fontSize: 14, fontWeight: 600, color: T.t3, marginLeft: 6 }}>（测试）</span>
            {isPractice && <span style={{ color: LISTENING_ACCENT.color }}> Practice</span>}
            {isChallenge && <span style={{ color: CH.accent }}> Challenge</span>}
          </h1>
          <div className="tp-mode-switcher" style={{ display: "inline-flex", gap: 4, flexShrink: 0, background: isChallenge ? "rgba(255,255,255,0.05)" : T.card, border: `1px solid ${isChallenge ? "rgba(255,30,30,0.3)" : T.bdr}`, borderRadius: 999, padding: 4, boxShadow: T.shadow }}>
            {[
              { value: PRACTICE_MODE.STANDARD, label: "Standard" },
              { value: PRACTICE_MODE.PRACTICE, label: "Practice" },
            ].map((option) => {
              const selected = mode === option.value;
              const practiceOption = option.value === PRACTICE_MODE.PRACTICE;
              return (
                <button
                  key={option.value}
                  onClick={() => switchMode(option.value)}
                  style={{
                    border: "none",
                    background: selected ? (practiceOption ? "rgba(139,92,246,0.12)" : "#fff") : "transparent",
                    color: selected ? (practiceOption ? LISTENING_ACCENT.color : T.t1) : (isChallenge ? CH.t2 : T.t2),
                    borderRadius: 999, padding: "5px 14px", fontSize: 12, fontWeight: 700,
                    cursor: "pointer", transition: "all .15s",
                    boxShadow: selected && !practiceOption ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
                    fontFamily: HOME_FONT,
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: isChallenge ? CH.accent : T.t2, fontWeight: isChallenge ? 600 : 400 }}>
          {isPractice
            ? "自选题目，不限时间，自由练习。"
            : "TOEFL 2026 新听力题型：选择回应、公告、对话、学术讲座。"}
        </p>
      </div>

      {/* Feature strip */}
      <div style={{ background: isChallenge ? "rgba(17,17,24,0.7)" : T.card, border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`, borderRadius: 10, padding: "10px 16px", marginBottom: 16, boxShadow: isChallenge ? "none" : T.shadow, ...fadeIn(120) }}>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12, color: isChallenge ? CH.t2 : T.t2 }}>
          <span>- 四种听力题型（选择回应 · 公告 · 对话 · 讲座）</span>
          <span>- 模拟考试限时练习</span>
          <span>- TTS 语音播放</span>
          <span>- 仅供练习使用，不代表官方考试评分</span>
        </div>
      </div>

      {/* New badge */}
      <div style={{
        background: `linear-gradient(135deg, ${LISTENING_ACCENT.soft}, #EDE9FE)`,
        border: `1px solid ${LISTENING_ACCENT.color}30`,
        borderRadius: 10, padding: "12px 16px", marginBottom: 16,
        display: "flex", alignItems: "center", gap: 10,
        ...fadeIn(150),
      }}>
        <span style={{ fontSize: 18 }}>🆕</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: LISTENING_ACCENT.color }}>2026 新题型</div>
          <div style={{ fontSize: 12, color: T.t2 }}>基于 ETS 官方公布的 TOEFL 2026 改革题型，AI 辅助生成练习内容</div>
        </div>
      </div>

      {/* Pro gate */}
      {!isPro && (
        <div style={{
          background: isChallenge ? "rgba(255,255,255,0.04)" : "#FFFBEB",
          border: `1px solid ${isChallenge ? CH.cardBorder : "#FDE68A"}`,
          borderRadius: 10, padding: "16px 20px", marginBottom: 16,
          display: "flex", alignItems: "center", gap: 12,
          ...fadeIn(160),
        }}>
          <span style={{ fontSize: 22 }}>🔒</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: isChallenge ? CH.t1 : T.t1 }}>Pro 专属功能</div>
            <div style={{ fontSize: 12, color: isChallenge ? CH.t2 : T.t2, marginTop: 2 }}>
              听力模块目前处于测试阶段，仅对 Pro 用户开放
            </div>
          </div>
          {!isLoggedIn ? (
            <button onClick={showLoginModal} style={{
              padding: "8px 16px", borderRadius: 8, border: "none",
              background: LISTENING_ACCENT.color, color: "#fff",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>登录</button>
          ) : (
            <button onClick={() => { try { window.dispatchEvent(new CustomEvent("open-upgrade-modal")); } catch {} }} style={{
              padding: "8px 16px", borderRadius: 8, border: "none",
              background: LISTENING_ACCENT.color, color: "#fff",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>升级 Pro</button>
          )}
        </div>
      )}

      {/* Task grid — identical to Writing/Reading pattern */}
      <div className="home-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 28 }}>
        {gridItems.map((item) => (
          <div key={item.k} style={{
            display: "flex",
            opacity: isPro ? 1 : 0.45,
            pointerEvents: isPro ? "auto" : "none",
            filter: isPro ? "none" : "grayscale(0.5)",
            ...fadeIn(item.delay),
          }}>
            <HomeTaskCard item={item} hoverKey={hoverKey} setHoverKey={setHoverKey} isChallenge={isChallenge} />
          </div>
        ))}
        {/* Adaptive mock exam card */}
        <div key="listening-exam" style={{
          display: "flex",
          opacity: isPro ? 1 : 0.45,
          pointerEvents: isPro ? "auto" : "none",
          filter: isPro ? "none" : "grayscale(0.5)",
          ...fadeIn(470),
        }}>
          <HomeTaskCard
            item={{
              k: "listening-exam",
              href: "/listening-exam",
              acc: LISTENING_ACCENT,
              n: "\u6A21\u8003",
              t: "\u542C\u529B\u81EA\u9002\u5E94\u6A21\u8003",
              d: "Module 1 + Module 2 \u81EA\u9002\u5E94\u96BE\u5EA6",
              it: "30 \u9898",
              timeLabel: "22 min",
              isMock: true,
              delay: 0,
            }}
            hoverKey={hoverKey}
            setHoverKey={setHoverKey}
            isChallenge={isChallenge}
          />
        </div>
      </div>

      {/* Practice history link */}
      {isPro && <ListeningHistoryLink isChallenge={isChallenge} hoverKey={hoverKey} setHoverKey={setHoverKey} fadeIn={fadeIn} />}

      {/* Footer */}
      <div style={{ fontSize: 10, color: isChallenge ? CH.t2 : T.t3, opacity: 0.65, lineHeight: 1.6, textAlign: "center", ...fadeIn(520) }}>
        TreePractice 为独立练习工具，与 ETS 无关联。TOEFL® 为 ETS 注册商标。练习内容由 AI 辅助生成，仅供自学参考。
      </div>
    </div>
  );
}

function ListeningHistoryLink({ isChallenge, hoverKey, setHoverKey, fadeIn }) {
  const [listeningCount, setListeningCount] = useState(0);

  useEffect(() => {
    try {
      const hist = loadHist();
      const count = (hist.sessions || []).filter(s => s.type === "listening").length;
      setListeningCount(count);
    } catch {}
    function onUpdate() {
      try {
        const hist = loadHist();
        setListeningCount((hist.sessions || []).filter(s => s.type === "listening").length);
      } catch {}
    }
    window.addEventListener("toefl-history-updated", onUpdate);
    return () => window.removeEventListener("toefl-history-updated", onUpdate);
  }, []);

  return (
    <div style={{ marginBottom: 20, ...fadeIn(380) }}>
      <HomeLinkCard
        href="/listening/progress"
        cardKey="listening-progress"
        hoverKey={hoverKey}
        setHoverKey={setHoverKey}
        isChallenge={isChallenge}
        icon="📈"
        eyebrow="记录"
        title="听力练习记录"
        description={listeningCount > 0 ? `已记录 ${listeningCount} 次听力练习，可在练习记录中查看。` : "完成听力练习后，记录会自动保存在这里。"}
        badge={listeningCount > 0 ? `${listeningCount} 条记录` : "暂无记录"}
      />
    </div>
  );
}
