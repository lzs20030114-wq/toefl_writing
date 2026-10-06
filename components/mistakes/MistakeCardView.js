"use client";
import { useMemo } from "react";
import Link from "next/link";
import { C } from "../shared/ui";
import { translateGrammarPoint } from "../../lib/utils";
import { useBsAiExplain, BsAiExplainBlock } from "../buildSentence/useBsAiExplain";
import { useMcqAiExplain } from "./useMcqAiExplain";
import { McqMistakeCard } from "./McqMistakesView";
import { SUBJECT_META, SUBTYPE_META } from "../../lib/mistakes/extract";
import { relativeDay } from "../../lib/mistakes/format";

/** 三科 AI 讲解 hook 打包（错题本 / 练错题报告共用；都是 Pro 门 + localStorage 缓存 + 点了才计费）。 */
export function useMistakeAi() {
  const bs = useBsAiExplain();
  const reading = useMcqAiExplain("reading");
  const listening = useMcqAiExplain("listening");
  return { bs, reading, listening };
}

/** 讲解要的上下文：阅读给文章、听力给原文（对话按「说话人: 句子」拼回）。 */
export function contextForCard(card, items) {
  const it = card?.itemKey ? items?.[card.itemKey] : null;
  if (!it) return {};
  if (card.subject === "reading") return { passage: it.passage || "" };
  if (card.subject === "listening") {
    const conv = Array.isArray(it.conversation)
      ? it.conversation.map((t) => `${t?.speaker || ""}: ${t?.text || ""}`).join("\n")
      : "";
    return { contextText: it.transcript || conv || "" };
  }
  return {};
}

function Tag({ children, color = C.t2, bg = "#f1f5f9", title }) {
  return (
    <span title={title} style={{ fontSize: 11, fontWeight: 700, color, background: bg, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function IconBtn({ onClick, title, children, active, color }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      style={{
        border: `1px solid ${active ? color || C.bdr : C.bdr}`,
        background: active ? "#fffbeb" : "#fff",
        color: active ? color || C.t1 : C.t2,
        borderRadius: 8,
        padding: "4px 10px",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        whiteSpace: "nowrap",
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

function BsBody({ brief, explainKey, ai }) {
  const detail = useMemo(() => ({
    prompt: brief.prompt,
    userAnswer: brief.userAnswer,
    correctAnswer: brief.correctAnswer,
    grammar_points: brief.grammar_points || [],
    isCorrect: false,
  }), [brief]);
  return (
    <div>
      <div style={{ fontSize: 13, color: C.t2, lineHeight: 1.5, marginBottom: 8 }}>{brief.prompt}</div>
      <div style={{ fontSize: 13.5, marginBottom: 4, lineHeight: 1.6 }}>
        <span style={{ fontWeight: 700, color: C.t2, marginRight: 6, fontSize: 12 }}>你的答案</span>
        <span style={{ color: C.red }}>{brief.userAnswer || "(未作答)"}</span>
      </div>
      <div style={{ fontSize: 13.5, marginBottom: 8, lineHeight: 1.6 }}>
        <span style={{ fontWeight: 700, color: C.t2, marginRight: 6, fontSize: 12 }}>正确答案</span>
        <span style={{ color: C.green }}>{brief.correctAnswer}</span>
      </div>
      {(brief.grammar_points || []).length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 4 }}>
          {brief.grammar_points.map((gp, i) => (
            <span key={i} style={{ fontSize: 11, fontWeight: 600, color: C.blue, background: C.ltB, borderRadius: 999, padding: "2px 9px" }}>
              {translateGrammarPoint(gp)}
            </span>
          ))}
        </div>
      )}
      <BsAiExplainBlock
        explainKey={explainKey}
        detail={detail}
        aiExplains={ai.bs.aiExplains}
        isLegacy={ai.bs.isLegacy}
        handleAiExplain={ai.bs.handleAiExplain}
      />
    </div>
  );
}

/**
 * 一题一张的错题卡。actions 全部可选：
 *   onToggleStar / onRemove / onRestore / drillHref —— 错题本列表用
 *   resultTag / extra —— 练错题结算页用（「和上次错得一样」标签 / 上一次的答案）
 */
export function MistakeItemCard({ card, items, ai, onToggleStar, onRemove, onRestore, drillHref, resultTag, extra, showMeta = true }) {
  const subject = SUBJECT_META[card.subject] || SUBJECT_META.bs;
  const sub = SUBTYPE_META[card.subtype];
  const explainKey = `mn-${card.key}`;
  const context = useMemo(() => contextForCard(card, items), [card, items]);
  const it = card.itemKey ? items?.[card.itemKey] : null;

  return (
    <div
      data-testid="mistake-card"
      data-key={card.key}
      style={{ background: "#fff", border: `1px solid ${C.bdr}`, borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        <Tag color={subject.color} bg={subject.soft}>{sub?.label || card.subtype}</Tag>
        {showMeta && card.wrongCount > 1 && <Tag color="#b91c1c" bg="#fef2f2">错 {card.wrongCount} 次</Tag>}
        {card.real && <Tag color="#B45309" bg="#FFF7ED">真题</Tag>}
        {card.mock && <Tag color={C.t2}>模考</Tag>}
        {card.subtype !== "bs" && card.subtype !== "lcr" && it?.topic ? (
          <span style={{ fontSize: 11.5, color: C.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{it.topic}</span>
        ) : null}
        {showMeta && (
          <span style={{ fontSize: 11.5, color: C.t3 }} title={card.firstWrongAt ? `第一次错：${new Date(card.firstWrongAt).toLocaleString()}` : undefined}>
            上次错：{relativeDay(card.lastWrongAt)}
          </span>
        )}
        {showMeta && card.lastDrill && (
          <Tag color={card.lastDrill.correct ? C.green : "#b91c1c"} bg={card.lastDrill.correct ? "#ecfdf5" : "#fef2f2"} title={`上次重做：${relativeDay(card.lastDrill.at)}`}>
            上次重做{card.lastDrill.correct ? "✓" : "✗"}
          </Tag>
        )}
        {resultTag}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {onToggleStar && (
            <IconBtn onClick={() => onToggleStar(card)} title={card.starred ? "取消收藏" : "收藏"} active={card.starred} color="#d97706">
              {card.starred ? "★ 已收藏" : "☆ 收藏"}
            </IconBtn>
          )}
          {drillHref && (
            <Link href={drillHref} style={{ border: `1px solid ${C.bdr}`, background: "#fff", color: C.t2, borderRadius: 8, padding: "4px 10px", fontSize: 12, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>
              {card.subtype === "bs" || card.subtype === "lcr" ? "只练这题" : "重做这篇"}
            </Link>
          )}
          {onRemove && <IconBtn onClick={() => onRemove(card)} title="移出错题本">移出</IconBtn>}
          {onRestore && <IconBtn onClick={() => onRestore(card)} title="放回错题本">放回</IconBtn>}
        </div>
      </div>
      {extra}
      {card.subject === "bs" ? (
        <BsBody brief={card.brief || {}} explainKey={explainKey} ai={ai} />
      ) : (
        <McqMistakeCard
          mistake={card.brief || {}}
          context={context}
          explainKey={explainKey}
          aiExplains={ai[card.subject].aiExplains}
          isPro={ai[card.subject].isPro}
          handleAiExplain={ai[card.subject].handleAiExplain}
          section={card.subject}
          bare
        />
      )}
    </div>
  );
}
