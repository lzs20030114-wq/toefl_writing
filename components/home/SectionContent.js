"use client";

import { SECTIONS, SECTION_STATUS, SECTION_ACCENTS } from "./sections";
import { CHALLENGE_TOKENS as CH, HOME_FONT, HOME_TOKENS as T } from "./theme";
import { PRACTICE_MODE } from "../../lib/practiceMode";
import { HomeLinkCard, HomeTaskCard } from "./HomeTaskCard";
import { PromoBanner } from "./HomePageClient";
import { ComingSoonSection } from "./ComingSoonSection";
import { ReadingSectionContent } from "./ReadingSectionContent";

export function SectionContent({
  activeSection,
  isChallenge, isPractice, mode, switchMode,
  gridItems, hoverKey, setHoverKey,
  postWritingCounts, bsMistakeCount, sessions,
  fadeIn,
}) {
  const section = SECTIONS.find((s) => s.id === activeSection);
  if (!section) return null;

  if (section.status === SECTION_STATUS.COMING_SOON) {
    return <ComingSoonSection section={section} isChallenge={isChallenge} fadeIn={fadeIn} />;
  }

  if (activeSection === "reading") {
    return (
      <ReadingSectionContent
        isChallenge={isChallenge} isPractice={isPractice} mode={mode} switchMode={switchMode}
        hoverKey={hoverKey} setHoverKey={setHoverKey} fadeIn={fadeIn}
      />
    );
  }

  // Active section: Writing
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {/* Section header + mode switcher */}
      <div style={{ marginBottom: 16, ...fadeIn(50) }}>
        <div className="tp-home-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 10 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: isChallenge ? CH.t1 : T.t1, letterSpacing: -0.5, lineHeight: 1.2 }}>
            {isChallenge
              ? <>Writing <span style={{ color: CH.accent }}>Challenge</span></>
              : isPractice
                ? <>Writing <span style={{ color: "#6366f1" }}>Practice</span></>
                : "Writing"}
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
            ? "在压力下证明你的水平。时间更短，要求更高。"
            : isPractice
              ? "自选题目，不限时间，自由练习。"
              : "模拟考试计时、AI 评分与三类写作任务练习，适用于 TOEFL® 备考。"}
        </p>
      </div>

      {/* Feature strip */}
      <div style={{ background: isChallenge ? "rgba(17,17,24,0.7)" : T.card, border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`, borderRadius: 10, padding: "10px 16px", marginBottom: 16, boxShadow: isChallenge ? "none" : T.shadow, ...fadeIn(120) }}>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12, color: isChallenge ? CH.t2 : T.t2 }}>
          <span>- 覆盖三类写作任务（排序 · 邮件 · 学术讨论）</span>
          <span>- 模拟考试限时练习</span>
          <span>- AI 评分与反馈</span>
          <span>- 仅供练习使用，不代表官方考试评分</span>
        </div>
      </div>

      {/* Promo */}
      <PromoBanner isChallenge={isChallenge} fadeIn={fadeIn} />

      {/* Task grid */}
      <div className="home-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        {gridItems.map((item) => (
          <div key={item.k} style={{ display: "flex", ...fadeIn(item.delay) }}>
            <HomeTaskCard item={item} hoverKey={hoverKey} setHoverKey={setHoverKey} isChallenge={isChallenge} />
          </div>
        ))}
      </div>

      {/* Link cards */}
      <div style={{ marginBottom: 12, ...fadeIn(440) }}>
        <HomeLinkCard
          href="/post-writing-practice" cardKey="post-writing-practice"
          hoverKey={hoverKey} setHoverKey={setHoverKey} isChallenge={isChallenge}
          icon="Aa" eyebrow="写后练习" title="拼写填空练习"
          description={postWritingCounts.total > 0 ? `今日 ${postWritingCounts.today} 题，错题本 ${postWritingCounts.notebook} 题。` : "从 Task 2/3 历史反馈中提取拼写错误，做填空复习。"}
          badge={postWritingCounts.total > 0 ? `${postWritingCounts.total} 题` : "暂无题目"}
        />
      </div>
      <div style={{ marginBottom: 12, ...fadeIn(460) }}>
        <HomeLinkCard
          href="/mistake-notebook" cardKey="mistake-notebook"
          hoverKey={hoverKey} setHoverKey={setHoverKey} isChallenge={isChallenge}
          icon="✗" eyebrow="复习" title="拼句错题本"
          description={bsMistakeCount > 0 ? `已收录 ${bsMistakeCount} 道错题，点击查看详情和 AI 解析。` : "做完拼句练习后，错题会自动收录在这里。"}
          badge={bsMistakeCount > 0 ? `${bsMistakeCount} 题` : "暂无错题"}
        />
      </div>
      <div style={{ marginBottom: 28, ...fadeIn(500) }}>
        <HomeLinkCard
          href="/progress" cardKey="progress"
          hoverKey={hoverKey} setHoverKey={setHoverKey} isChallenge={isChallenge}
          icon="P" eyebrow="记录" title="练习记录"
          description={sessions.length > 0 ? `已记录 ${sessions.length} 次练习，可查看趋势和薄弱点。` : "查看练习趋势并定位薄弱点。"}
          badge={sessions.length > 0 ? `${sessions.length} 条记录` : "暂无记录"}
        />
      </div>

      {/* Footer */}
      <div style={{ fontSize: 10, color: isChallenge ? CH.t2 : T.t3, opacity: 0.65, lineHeight: 1.6, textAlign: "center", ...fadeIn(520) }}>
        TreePractice 为独立练习工具，与 ETS 无关联，也未获得其认可。TOEFL® 和 TOEFL iBT® 为 ETS 的注册商标。部分练习内容及评分反馈由 AI 辅助生成，仅供自学参考，不代表官方考试成绩。
        <br />
        <a href="/terms" style={{ color: "inherit", textDecoration: "underline" }}>使用条款与隐私政策</a>
      </div>
    </div>
  );
}
