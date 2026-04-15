"use client";

import { SECTION_ACCENTS } from "./sections";
import { CHALLENGE_TOKENS as CH, HOME_FONT, HOME_TOKENS as T } from "./theme";
import { PRACTICE_MODE } from "../../lib/practiceMode";
import { HomeTaskCard } from "./HomeTaskCard";

const LISTENING_ACCENT = SECTION_ACCENTS.listening;

const LISTENING_TASKS = [
  {
    k: "listening-lcr",
    n: "Task 1",
    t: "Choose a Response",
    d: "Listen to a sentence and choose the most appropriate response.",
    it: "10 questions",
    timeLabel: "5 min",
  },
  {
    k: "listening-la",
    n: "Task 2",
    t: "Listen to an Announcement",
    d: "Listen to a campus announcement and answer comprehension questions.",
    it: "2-3 questions",
    timeLabel: "3 min",
  },
  {
    k: "listening-lc",
    n: "Task 3",
    t: "Listen to a Conversation",
    d: "Listen to a short campus conversation and answer questions.",
    it: "2 questions",
    timeLabel: "5 min",
  },
  {
    k: "listening-lat",
    n: "Task 4",
    t: "Academic Talk",
    d: "Listen to a short academic lecture and answer comprehension questions.",
    it: "3-5 questions",
    timeLabel: "8 min",
  },
];

export function ListeningSectionContent({
  isChallenge, isPractice, mode, switchMode,
  hoverKey, setHoverKey, fadeIn,
  userTier, isLoggedIn, showLoginModal,
}) {
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
              ? <>Listening <span style={{ color: CH.accent }}>Challenge</span></>
              : isPractice
                ? <>Listening <span style={{ color: LISTENING_ACCENT.color }}>Practice</span></>
                : "Listening"}
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
            ? "自选题目，不限时间，自由练习听力。"
            : "TOEFL 2026 新听力题型：选择回应、公告、对话、学术讲座。"}
        </p>
      </div>

      {/* Feature strip */}
      <div style={{ background: isChallenge ? "rgba(17,17,24,0.7)" : T.card, border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`, borderRadius: 10, padding: "10px 16px", marginBottom: 16, boxShadow: isChallenge ? "none" : T.shadow, ...fadeIn(120) }}>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12, color: isChallenge ? CH.t2 : T.t2 }}>
          <span>🎧 四种听力题型（2026 新托福）</span>
          <span>📝 模拟考试限时练习</span>
          <span>🔊 支持 TTS 语音播放</span>
          <span>⚠️ 仅供练习使用</span>
        </div>
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
