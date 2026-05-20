"use client";

import { useEffect, useMemo, useState } from "react";
import { C, SurfaceCard, DisclosureSection } from "../shared/ui";
import { formatLocalDateTime } from "../../lib/utils";
import { useMcqAiExplain, McqAiExplainBlock } from "./useMcqAiExplain";

function buildSubtypeStats(groups) {
  const map = {};
  for (const g of groups) {
    const key = g.subtype || "unknown";
    if (!map[key]) {
      map[key] = { subtype: key, label: g.subtypeLabel || key, count: 0 };
    }
    map[key].count += g.wrongCount;
  }
  return Object.values(map).sort((a, b) => b.count - a.count);
}

function StatBlock({ groups, visibleGroupCount, totalWrong, section, activeSubtype, onSubtypeSelect }) {
  const subtypeStats = useMemo(() => buildSubtypeStats(groups), [groups]);
  const groupCount = visibleGroupCount;
  const accent = section === "reading" ? "#1d4ed8" : "#6d28d9";
  const soft = section === "reading" ? "#EFF6FF" : "#F3E8FF";

  return (
    <SurfaceCard style={{ padding: "16px 18px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 800, color: C.red }}>{totalWrong}</div>
          <div style={{ fontSize: 12, color: C.t3 }}>道错题</div>
        </div>
        <div>
          <div style={{ fontSize: 26, fontWeight: 800, color: C.t1 }}>{groupCount}</div>
          <div style={{ fontSize: 12, color: C.t3 }}>套练习</div>
        </div>
        {subtypeStats.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {subtypeStats.map((s) => {
              const active = activeSubtype === s.subtype;
              return (
                <button
                  key={s.subtype}
                  type="button"
                  onClick={() => onSubtypeSelect(active ? null : s.subtype)}
                  aria-pressed={active}
                  title={active ? "Show all mistake types" : `Filter by ${s.label}`}
                  style={{
                    padding: "6px 10px",
                    background: active ? accent : soft,
                    color: active ? "#fff" : accent,
                    border: `1px solid ${active ? accent : "transparent"}`,
                    borderRadius: 6,
                    fontSize: 12,
                    fontFamily: "inherit",
                    fontWeight: 600,
                    cursor: "pointer",
                    lineHeight: 1.2,
                    boxShadow: active ? "0 1px 4px rgba(15,23,42,0.12)" : "none",
                    transition: "background 0.15s, color 0.15s, box-shadow 0.15s",
                  }}
                >
                  {s.label} · {s.count}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </SurfaceCard>
  );
}

function OptionRow({ optionKey, text, isSelected, isCorrect }) {
  const wrong = isSelected && !isCorrect;
  const right = isCorrect;
  return (
    <div style={{
      display: "flex",
      gap: 8,
      padding: "5px 8px",
      borderRadius: 6,
      background: right ? "#ecfdf5" : wrong ? "#fef2f2" : "transparent",
      border: right ? "1px solid #bbf7d0" : wrong ? "1px solid #fecaca" : "1px solid transparent",
      marginBottom: 4,
    }}>
      <span style={{
        flexShrink: 0,
        fontWeight: 700,
        color: right ? "#15803d" : wrong ? "#b91c1c" : C.t3,
        fontSize: 12,
        minWidth: 16,
      }}>
        {optionKey}.
      </span>
      <span style={{ fontSize: 12.5, color: C.t1, lineHeight: 1.55, flex: 1 }}>{text}</span>
      {right && (
        <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: "#15803d", alignSelf: "center" }}>正确</span>
      )}
      {wrong && (
        <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: "#b91c1c", alignSelf: "center" }}>你选</span>
      )}
    </div>
  );
}

function McqMistakeCard({ mistake, context, explainKey, aiExplains, isPro, handleAiExplain, section }) {
  const hasOptions = mistake.options && mistake.optionsKey && mistake.optionsKey.length > 0;

  return (
    <div style={{
      padding: "14px 16px",
      borderLeft: `4px solid ${C.red}`,
      background: "#fff",
      borderRadius: 6,
      marginBottom: 10,
    }}>
      {/* stem */}
      {mistake.stem && (
        <div style={{ fontSize: 13.5, color: C.t1, lineHeight: 1.55, marginBottom: 10, fontWeight: 600 }}>
          {mistake.stem}
        </div>
      )}

      {hasOptions ? (
        <div style={{ marginBottom: 8 }}>
          {mistake.optionsKey.map((k) => (
            <OptionRow
              key={k}
              optionKey={k}
              text={mistake.options[k]}
              isSelected={mistake.selected === k}
              isCorrect={mistake.correctKey === k}
            />
          ))}
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13.5, marginBottom: 4, lineHeight: 1.6 }}>
            <span style={{ fontWeight: 700, color: C.t2, marginRight: 6, fontSize: 12 }}>你的答案</span>
            <span style={{ color: C.red }}>{mistake.userAnswer || "(未作答)"}</span>
          </div>
          <div style={{ fontSize: 13.5, marginBottom: 8, lineHeight: 1.6 }}>
            <span style={{ fontWeight: 700, color: C.t2, marginRight: 6, fontSize: 12 }}>正确答案</span>
            <span style={{ color: C.green }}>{mistake.correctAnswer}</span>
          </div>
        </>
      )}

      {/* sentence context (CTW only) */}
      {mistake.sentenceContext && !hasOptions && (
        <div style={{
          marginTop: 6,
          padding: "8px 10px",
          background: "#f8fafb",
          border: "1px solid #e2e8f0",
          borderRadius: 6,
          fontSize: 12,
          color: C.t2,
          lineHeight: 1.6,
        }}>
          {mistake.sentenceContext}
        </div>
      )}

      {/* bank explanation */}
      {mistake.explanation && (
        <div style={{
          marginTop: 8,
          padding: "8px 10px",
          background: "#fffbeb",
          border: "1px solid #fde68a",
          borderRadius: 6,
          fontSize: 12,
          color: "#7c5b00",
          lineHeight: 1.65,
        }}>
          <span style={{ fontWeight: 700, marginRight: 6 }}>解析</span>
          {mistake.explanation}
        </div>
      )}

      {/* AI explanation */}
      <McqAiExplainBlock
        explainKey={explainKey}
        mistake={mistake}
        context={context}
        aiExplains={aiExplains}
        isPro={isPro}
        handleAiExplain={handleAiExplain}
        section={section}
      />
    </div>
  );
}

export function McqMistakesView({ groups, section, emptyHint }) {
  const [activeSubtype, setActiveSubtype] = useState(null);
  const filteredGroups = useMemo(
    () => (activeSubtype ? groups.filter((g) => g.subtype === activeSubtype) : groups),
    [groups, activeSubtype],
  );
  const totalWrong = useMemo(
    () => filteredGroups.reduce((n, g) => n + g.wrongCount, 0),
    [filteredGroups],
  );
  const { aiExplains, isPro, handleAiExplain } = useMcqAiExplain(section);

  useEffect(() => {
    if (activeSubtype && !groups.some((g) => g.subtype === activeSubtype)) {
      setActiveSubtype(null);
    }
  }, [activeSubtype, groups]);

  if (groups.length === 0) {
    return (
      <SurfaceCard style={{ padding: "48px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.t1, marginBottom: 6 }}>
          暂无错题
        </div>
        <div style={{ fontSize: 13, color: C.t3, lineHeight: 1.6 }}>
          {emptyHint || "完成练习后，答错的题会自动收录在这里。"}
        </div>
      </SurfaceCard>
    );
  }

  return (
    <>
      <StatBlock
        groups={groups}
        visibleGroupCount={filteredGroups.length}
        totalWrong={totalWrong}
        section={section}
        activeSubtype={activeSubtype}
        onSubtypeSelect={setActiveSubtype}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filteredGroups.map((g, gi) => (
          <DisclosureSection
            key={`${activeSubtype || "all"}-${g.key}`}
            title={`第 ${filteredGroups.length - gi} 套 · ${g.wrongCount}/${g.total} 错题`}
            preview={`${g.subtypeLabel || ""} · ${formatLocalDateTime(g.date)}`}
            badge={`${g.wrongCount} 题`}
            icon="✗"
            defaultOpen={gi === 0}
            contentStyle={{ padding: "12px 14px", background: C.bg }}
          >
            {g.mistakes.map((m, mi) => (
              <McqMistakeCard
                key={`${g.key}-${mi}`}
                mistake={m}
                context={{ passage: g.passage, contextText: g.contextText }}
                explainKey={`${section}-${gi}-${mi}`}
                aiExplains={aiExplains}
                isPro={isPro}
                handleAiExplain={handleAiExplain}
                section={section}
              />
            ))}
          </DisclosureSection>
        ))}
      </div>
    </>
  );
}
