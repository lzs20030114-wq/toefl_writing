"use client";

import { useState, useEffect } from "react";
import { SECTION_ACCENTS } from "./sections";
import { CHALLENGE_TOKENS as CH, HOME_FONT, HOME_TOKENS as T } from "./theme";
import { PRACTICE_MODE } from "../../lib/practiceMode";
import { HomeTaskCard, HomeLinkCard } from "./HomeTaskCard";
import { loadHist } from "../../lib/sessionStore";

const READING_ACCENT = SECTION_ACCENTS.reading;

const READING_TASKS = [
  {
    k: "reading-ctw",
    n: "Task 1",
    t: "Complete the Words",
    d: "Fill in missing letters using context clues from an academic passage.",
    it: "10 blanks",
    timeLabel: "5 min",
    standardLabel: "5 min",
  },
  {
    k: "reading-rdl",
    n: "Task 2",
    t: "Read in Daily Life",
    d: "Read a campus notice, email, or post and answer comprehension questions.",
    it: null, // dynamic based on variant
    timeLabel: null, // dynamic based on variant
    standardLabel: null,
  },
  {
    k: "reading-ap",
    n: "Task 3",
    t: "Academic Passage",
    d: "Read a ~200-word academic text and answer 5 comprehension questions.",
    it: "5 questions",
    timeLabel: "8 min",
    standardLabel: "8 min",
  },
];

export function ReadingSectionContent({
  isChallenge, isPractice, mode, switchMode,
  hoverKey, setHoverKey, fadeIn,
  userTier, isLoggedIn, showLoginModal,
}) {
  const isPro = userTier === "pro" || userTier === "legacy";
  const [rdlVariant, setRdlVariant] = useState("long"); // "short" | "long"

  const modeStr = isPractice ? "practice" : mode === PRACTICE_MODE.CHALLENGE ? "challenge" : "standard";

  const gridItems = READING_TASKS.map((task, index) => {
    const isRdl = task.k === "reading-rdl";
    const isAp = task.k === "reading-ap";
    const isShort = rdlVariant === "short";

    let href;
    if (isRdl) href = `/reading?type=rdl&variant=${rdlVariant}&mode=${modeStr}`;
    else if (isAp) href = `/reading?type=ap&mode=${modeStr}`;
    else href = `/reading?type=ctw&mode=${modeStr}`;

    return {
      k: task.k,
      href,
      acc: READING_ACCENT,
      n: task.n,
      t: task.t,
      d: isPractice ? "自选题目，不限时间。" : task.d,
      it: isRdl ? (isShort ? "2 questions" : "3 questions") : task.it,
      timeLabel: isPractice ? "不限时" : (isRdl ? (isShort ? "2 min" : "4 min") : task.timeLabel),
      standardLabel: isRdl ? (isShort ? "2 min" : "4 min") : task.standardLabel,
      isMock: false,
      delay: 190 + index * 70,
    };
  });

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {/* Section header */}
      <div style={{ marginBottom: 16, ...fadeIn(50) }}>
        <div className="tp-home-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 10 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: isChallenge ? CH.t1 : T.t1, letterSpacing: -0.5, lineHeight: 1.2 }}>
            Reading
            <span style={{ fontSize: 14, fontWeight: 600, color: T.t3, marginLeft: 6 }}>（测试）</span>
            {isPractice && <span style={{ color: "#6366f1" }}> Practice</span>}
            {isChallenge && <span style={{ color: CH.accent }}> Challenge</span>}
          </h1>
          <div className="tp-mode-switcher" style={{ display: "inline-flex", gap: 4, flexShrink: 0, background: isChallenge ? "rgba(255,255,255,0.05)" : T.card, border: `1px solid ${isChallenge ? "rgba(255,30,30,0.3)" : T.bdr}`, borderRadius: 999, padding: 4, boxShadow: T.shadow }}>
            {[
              { value: PRACTICE_MODE.STANDARD, label: "Standard" },
              { value: PRACTICE_MODE.PRACTICE, label: "Practice" },
              { value: PRACTICE_MODE.CHALLENGE, label: "Challenge" },
            ].map((option) => {
              const selected = mode === option.value;
              const challengeOption = option.value === PRACTICE_MODE.CHALLENGE;
              const practiceOption = option.value === PRACTICE_MODE.PRACTICE;
              return (
                <button
                  key={option.value}
                  onClick={() => switchMode(option.value)}
                  style={{
                    border: "none",
                    background: selected ? (challengeOption ? "rgba(255,30,30,0.18)" : practiceOption ? "rgba(99,102,241,0.12)" : "#fff") : "transparent",
                    color: selected ? (challengeOption ? CH.accent : practiceOption ? "#6366f1" : T.t1) : (isChallenge ? CH.t2 : T.t2),
                    borderRadius: 999, padding: "5px 14px", fontSize: 12, fontWeight: 700,
                    cursor: "pointer", transition: "all .15s",
                    boxShadow: selected && !challengeOption && !practiceOption ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
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
          {isChallenge
            ? "在压力下证明你的阅读理解能力。"
            : isPractice
              ? "自选题目，不限时间，自由练习。"
              : "TOEFL 2026 新版阅读题型练习，含单词补全和日常阅读理解。"}
        </p>
      </div>

      {/* Feature strip */}
      <div style={{ background: isChallenge ? "rgba(17,17,24,0.7)" : T.card, border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`, borderRadius: 10, padding: "10px 16px", marginBottom: 16, boxShadow: isChallenge ? "none" : T.shadow, ...fadeIn(120) }}>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12, color: isChallenge ? CH.t2 : T.t2 }}>
          <span>- TOEFL 2026 新题型（Complete the Words · Read in Daily Life）</span>
          <span>- AI 生成练习题</span>
          <span>- 即时判分与解析</span>
        </div>
      </div>

      {/* New badge */}
      <div style={{
        background: `linear-gradient(135deg, ${READING_ACCENT.soft}, #DBEAFE)`,
        border: `1px solid ${READING_ACCENT.color}30`,
        borderRadius: 10, padding: "12px 16px", marginBottom: 16,
        display: "flex", alignItems: "center", gap: 10,
        ...fadeIn(150),
      }}>
        <span style={{ fontSize: 18 }}>🆕</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: READING_ACCENT.color }}>2026 新题型</div>
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
              阅读理解模块目前处于测试阶段，仅对 Pro 用户开放
            </div>
          </div>
          {!isLoggedIn ? (
            <button
              onClick={showLoginModal}
              style={{
                padding: "8px 16px", borderRadius: 8, border: "none",
                background: READING_ACCENT.color, color: "#fff",
                fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}
            >
              登录
            </button>
          ) : (
            <button
              onClick={() => {
                try { window.dispatchEvent(new CustomEvent("open-upgrade-modal")); } catch {}
              }}
              style={{
                padding: "8px 16px", borderRadius: 8, border: "none",
                background: READING_ACCENT.color, color: "#fff",
                fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}
            >
              升级 Pro
            </button>
          )}
        </div>
      )}

      {/* Task grid */}
      <div className="home-grid" style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 28,
        opacity: isPro ? 1 : 0.45, pointerEvents: isPro ? "auto" : "none",
        filter: isPro ? "none" : "grayscale(0.5)",
      }}>
        {gridItems.map((item) => {
          const isRdl = item.k === "reading-rdl";
          const rdlFooter = isRdl ? (
            <div
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2, padding: "6px 10px" }}
            >
              {["short", "long"].map(v => {
                const active = rdlVariant === v;
                return (
                  <button
                    key={v}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setRdlVariant(v); }}
                    style={{
                      padding: "4px 12px", borderRadius: 999, fontSize: 11, fontWeight: active ? 700 : 500,
                      border: "none",
                      color: active ? (isChallenge ? "#fff" : READING_ACCENT.color) : (isChallenge ? CH.t2 : T.t3),
                      background: active ? (isChallenge ? "rgba(59,130,246,0.2)" : READING_ACCENT.soft) : "transparent",
                      cursor: "pointer", transition: "all 150ms", fontFamily: HOME_FONT,
                    }}
                  >
                    {v === "short" ? "短版 · 2题" : "长版 · 3题"}
                  </button>
                );
              })}
            </div>
          ) : null;
          return (
            <div key={item.k} style={{ display: "flex", ...fadeIn(item.delay) }}>
              <HomeTaskCard item={item} hoverKey={hoverKey} setHoverKey={setHoverKey} isChallenge={isChallenge} footer={rdlFooter} />
            </div>
          );
        })}
        {/* Adaptive mock exam card */}
        <div key="reading-exam" style={{ display: "flex", ...fadeIn(400) }}>
          <HomeTaskCard
            item={{
              k: "reading-exam",
              href: "/reading-exam",
              acc: READING_ACCENT,
              n: "\u6A21\u8003",
              t: "\u9605\u8BFB\u81EA\u9002\u5E94\u6A21\u8003",
              d: "Module 1 + Module 2 \u81EA\u9002\u5E94\u96BE\u5EA6",
              it: "35 \u9898",
              timeLabel: "27 min",
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
      {isPro && <ReadingHistoryLink isChallenge={isChallenge} hoverKey={hoverKey} setHoverKey={setHoverKey} fadeIn={fadeIn} />}

      {/* Footer */}
      <div style={{ fontSize: 10, color: isChallenge ? CH.t2 : T.t3, opacity: 0.65, lineHeight: 1.6, textAlign: "center", ...fadeIn(520) }}>
        TreePractice 为独立练习工具，与 ETS 无关联。TOEFL® 为 ETS 注册商标。练习内容由 AI 辅助生成，仅供自学参考。
      </div>
    </div>
  );
}

function ReadingHistoryLink({ isChallenge, hoverKey, setHoverKey, fadeIn }) {
  const [readingCount, setReadingCount] = useState(0);

  useEffect(() => {
    try {
      const hist = loadHist();
      const count = (hist.sessions || []).filter(s => s.type === "reading").length;
      setReadingCount(count);
    } catch {}
    function onUpdate() {
      try {
        const hist = loadHist();
        setReadingCount((hist.sessions || []).filter(s => s.type === "reading").length);
      } catch {}
    }
    window.addEventListener("toefl-history-updated", onUpdate);
    return () => window.removeEventListener("toefl-history-updated", onUpdate);
  }, []);

  return (
    <div style={{ marginBottom: 20, ...fadeIn(380) }}>
      <HomeLinkCard
        href="/reading/progress"
        cardKey="reading-progress"
        hoverKey={hoverKey}
        setHoverKey={setHoverKey}
        isChallenge={isChallenge}
        icon="📈"
        eyebrow="记录"
        title="阅读练习记录"
        description={readingCount > 0 ? `已记录 ${readingCount} 次阅读练习，可在练习记录中查看。` : "完成阅读练习后，记录会自动保存在这里。"}
        badge={readingCount > 0 ? `${readingCount} 条记录` : "暂无记录"}
      />
    </div>
  );
}
