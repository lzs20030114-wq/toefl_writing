"use client";

import { SECTION_ACCENTS } from "./sections";
import { CHALLENGE_TOKENS as CH, HOME_FONT, HOME_TOKENS as T } from "./theme";
import { PRACTICE_MODE } from "../../lib/practiceMode";
import { HomeTaskCard } from "./HomeTaskCard";

const SPEAKING_ACCENT = SECTION_ACCENTS.speaking;

const SPEAKING_TASKS = [
  {
    k: "speaking-repeat",
    n: "Task 1",
    t: "Listen & Repeat",
    d: "Listen to 7 sentences and repeat each one. Tests pronunciation accuracy.",
    it: "7 sentences",
    timeLabel: "3 min",
  },
  {
    k: "speaking-interview",
    n: "Task 2",
    t: "Take an Interview",
    d: "Answer 4 interview questions, 45 seconds each. Difficulty increases.",
    it: "4 questions",
    timeLabel: "4 min",
  },
];

export function SpeakingSectionContent({
  isChallenge, isPractice, mode, switchMode,
  hoverKey, setHoverKey, fadeIn,
  userTier, isLoggedIn, showLoginModal,
}) {
  const modeStr = isPractice ? "practice" : mode === PRACTICE_MODE.CHALLENGE ? "challenge" : "standard";

  const gridItems = SPEAKING_TASKS.map((task) => {
    const typeMap = {
      "speaking-repeat": "repeat",
      "speaking-interview": "interview",
    };
    return {
      k: task.k,
      href: `/speaking?type=${typeMap[task.k]}&mode=${modeStr}`,
      acc: SPEAKING_ACCENT,
      n: task.n,
      t: task.t,
      d: isPractice ? "自选题目，不限时间。" : task.d,
      it: task.it,
      timeLabel: isPractice ? "自选" : task.timeLabel,
    };
  });

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {/* Section header + mode switcher */}
      <div style={{ marginBottom: 16, ...fadeIn(50) }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 10 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: isChallenge ? CH.t1 : T.t1, letterSpacing: -0.5, lineHeight: 1.2 }}>
            {isChallenge
              ? <>Speaking <span style={{ color: CH.accent }}>Challenge</span></>
              : isPractice
                ? <>Speaking <span style={{ color: SPEAKING_ACCENT.color }}>Practice</span></>
                : "Speaking"}
          </h1>
          <div style={{ display: "inline-flex", gap: 4, flexShrink: 0, background: isChallenge ? "rgba(255,255,255,0.05)" : T.card, border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`, borderRadius: 999, padding: 4, boxShadow: T.shadow }}>
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
                    background: selected ? (practiceOption ? "rgba(245,158,11,0.12)" : "#fff") : "transparent",
                    color: selected ? (practiceOption ? SPEAKING_ACCENT.color : T.t1) : (isChallenge ? CH.t2 : T.t2),
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
            ? "自选题目，不限时间，自由练习口语。"
            : "TOEFL 2026 新口语题型：听后复述、模拟面试。需要麦克风权限。"}
        </p>
      </div>

      {/* Feature strip */}
      <div style={{ background: isChallenge ? "rgba(17,17,24,0.7)" : T.card, border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`, borderRadius: 10, padding: "10px 16px", marginBottom: 16, boxShadow: isChallenge ? "none" : T.shadow, ...fadeIn(120) }}>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12, color: isChallenge ? CH.t2 : T.t2 }}>
          <span>🎙️ 录音自查模式（无 AI 评分）</span>
          <span>🗣 两种口语题型（2026 新托福）</span>
          <span>⏱ 模拟考试计时</span>
          <span>🔊 TTS 语音播放</span>
        </div>
      </div>

      {/* Microphone notice */}
      <div style={{ background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 10, padding: "10px 16px", marginBottom: 16, ...fadeIn(150) }}>
        <p style={{ margin: 0, fontSize: 12, color: "#92400E" }}>
          🎙️ 口语练习需要麦克风权限。首次使用时浏览器会弹出授权提示，请点击"允许"。目前为<strong>自查模式</strong>：录完后自己回听，暂无 AI 评分。
        </p>
      </div>

      {/* Task grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14, ...fadeIn(180) }}>
        {gridItems.map((item) => (
          <HomeTaskCard
            key={item.k}
            item={item}
            isChallenge={isChallenge}
            isHovered={hoverKey === item.k}
            onHover={() => setHoverKey(item.k)}
            onLeave={() => setHoverKey("")}
          />
        ))}
      </div>
    </div>
  );
}
