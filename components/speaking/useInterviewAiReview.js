"use client";
import { useState, useCallback, useEffect } from "react";
import { getSavedTier } from "../../lib/AuthContext";
import { callAI, mapAiHelperError } from "../../lib/ai/client";
import {
  getInterviewReviewSystemPrompt,
  buildInterviewReviewMessage,
  parseInterviewReview,
  interviewReviewCacheKey,
  reviewableAnswers,
  REVIEW_DIMENSIONS,
  INTERVIEW_REVIEW_MAX_TOKENS,
  INTERVIEW_REVIEW_TIMEOUT_MS,
} from "../../lib/ai/prompts/interviewReview";

// 模拟面试练后「AI 整场分析」。与 useListeningAiExplain / useReadingAiExplain 同一骨架：
// Pro 门 + localStorage 缓存 + 点了才计费。差别是输入不是一道题而是**一整场**——
// 4 题的转写 + 单题机器分一起给模型做跨题诊断（哪些毛病反复出现、最拖分的是哪一环、
// 下次怎么改、挑最低分那题改写示范）。prompt / 解析 / 缓存 key 全在
// lib/ai/prompts/interviewReview.js（纯函数，可直测）。
//
// 两个入口共用这一份：口语练习记录 InterviewDetail（/speaking/progress 与
// /real-bank/progress 共用），以及 InterviewTask 答完 4 题的结束页。缓存 key 只看
// 「题 + 转写 + 分」，结束页当场生成的分析回到练习记录里打开会直接命中。

const CACHE_KEY = "interview-ai-review-cache-v1";
const MAX_CACHE = 60;

function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveToCache(key, report) {
  try {
    const cache = loadCache();
    cache[key] = report;
    const keys = Object.keys(cache);
    if (keys.length > MAX_CACHE) {
      keys.slice(0, keys.length - MAX_CACHE).forEach((k) => delete cache[k]);
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

function getFromCache(key) {
  try {
    const hit = loadCache()[key];
    return hit && typeof hit === "object" ? hit : null;
  } catch {
    return null;
  }
}

export function useInterviewAiReview() {
  const [reviews, setReviews] = useState({});
  const tier = typeof window !== "undefined" ? getSavedTier() : null;
  const isPro = tier === "legacy" || tier === "pro";

  const runReview = useCallback(async (key, input) => {
    const cached = getFromCache(key);
    if (cached) {
      setReviews((prev) => ({ ...prev, [key]: { loading: false, report: cached, error: null } }));
      return;
    }
    setReviews((prev) => ({ ...prev, [key]: { loading: true, report: null, error: null } }));
    try {
      const raw = await callAI(
        getInterviewReviewSystemPrompt(),
        buildInterviewReviewMessage(input),
        INTERVIEW_REVIEW_MAX_TOKENS,
        INTERVIEW_REVIEW_TIMEOUT_MS,
        0.3,
      );
      const report = parseInterviewReview(raw);
      saveToCache(key, report);
      setReviews((prev) => ({ ...prev, [key]: { loading: false, report, error: null } }));
    } catch (e) {
      // 解析失败（模型没按 JSON 出）和网络/额度错误分开给文案；后者走统一映射，
      // 绝不把 e.message 原样渲染给用户（见 lib/ai/client.js mapAiHelperError 注释）。
      const isParse = /json|review missing|no json/i.test(String(e?.message || ""));
      const error = isParse ? "AI 返回格式异常，请重试" : mapAiHelperError(e);
      setReviews((prev) => ({ ...prev, [key]: { loading: false, report: null, error } }));
    }
  }, []);

  return { reviews, isPro, runReview };
}

// ── 视觉 ──
const AMBER = "#F59E0B";
const AMBER_SOFT = "#FFFBEB";
const AMBER_LINE = "#FDE68A";
const TEXT = "#1a2420";
const TEXT_SEC = "#5a6b62";
const TEXT_DIM = "#94a39a";
const LINE = "#ebf0ed";

const DIM_CHIP = {
  relevance: { bg: "#FEE2E2", fg: "#991B1B" },
  elaboration: { bg: "#FFEDD5", fg: "#9A3412" },
  organization: { bg: "#DCFCE7", fg: "#166534" },
  language: { bg: "#EDE9FE", fg: "#5B21B6" },
  fluency: { bg: "#FEF3C7", fg: "#92400E" },
};

function SectionTitle({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 750, color: TEXT_DIM, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 6 }}>
      {children}
    </div>
  );
}

function Evidence({ text }) {
  if (!text) return null;
  return (
    <div style={{ fontSize: 12, color: TEXT_SEC, fontStyle: "italic", lineHeight: 1.5, marginTop: 3, wordBreak: "break-word" }}>
      {text}
    </div>
  );
}

/** 报告正文。纯展示，不碰状态。 */
export function InterviewAiReviewReport({ report }) {
  if (!report) return null;
  const { overview, strengths, issues, patterns, rewrite, nextSteps, focus } = report;
  return (
    <div data-testid="interview-ai-review" style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 13, color: TEXT, lineHeight: 1.65 }}>
      {overview && (
        <div>
          <SectionTitle>总体判断</SectionTitle>
          <div style={{ wordBreak: "break-word" }}>{overview}</div>
        </div>
      )}

      {strengths && strengths.length > 0 && (
        <div>
          <SectionTitle>做得好的</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {strengths.map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 8 }}>
                <span style={{ color: "#16A34A", fontWeight: 800, flexShrink: 0 }}>✓</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ wordBreak: "break-word" }}>{s.point}</div>
                  <Evidence text={s.evidence} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {issues && issues.length > 0 && (
        <div>
          <SectionTitle>主要问题 · 按拖分程度排序</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {issues.map((it, i) => {
              const chip = DIM_CHIP[it.dimension];
              return (
                <div key={i} style={{ padding: "10px 12px", background: "#F9FAFB", border: `1px solid ${LINE}`, borderRadius: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: TEXT_DIM }}>{i + 1}</span>
                    {chip && (
                      <span style={{ fontSize: 10, fontWeight: 750, padding: "2px 8px", borderRadius: 999, background: chip.bg, color: chip.fg }}>
                        {REVIEW_DIMENSIONS[it.dimension]}
                      </span>
                    )}
                    <span style={{ fontWeight: 700, wordBreak: "break-word" }}>{it.title}</span>
                  </div>
                  <Evidence text={it.evidence} />
                  {it.why && <div style={{ fontSize: 12, color: TEXT_SEC, marginTop: 4, wordBreak: "break-word" }}>{it.why}</div>}
                  {it.fix && (
                    <div style={{ marginTop: 6, padding: "6px 10px", background: AMBER_SOFT, border: `1px solid ${AMBER_LINE}`, borderRadius: 8, fontSize: 12, color: "#78350F", wordBreak: "break-word" }}>
                      <span style={{ fontWeight: 800, marginRight: 4 }}>怎么改</span>
                      {it.fix}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {patterns && patterns.length > 0 && (
        <div>
          <SectionTitle>反复出现的习惯</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {patterns.map((p, i) => (
              <div key={i} style={{ display: "flex", gap: 8 }}>
                <span style={{ color: AMBER, fontWeight: 800, flexShrink: 0 }}>•</span>
                <span style={{ wordBreak: "break-word" }}>{p}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {rewrite && rewrite.improved && (
        <div>
          <SectionTitle>{rewrite.question ? `Q${rewrite.question} 改写示范` : "改写示范"}</SectionTitle>
          <div style={{ padding: "10px 12px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10, fontSize: 13, color: "#14532D", lineHeight: 1.7, wordBreak: "break-word" }}>
            {rewrite.improved}
          </div>
          {rewrite.changes && <div style={{ fontSize: 12, color: TEXT_SEC, marginTop: 6, wordBreak: "break-word" }}>{rewrite.changes}</div>}
        </div>
      )}

      {nextSteps && nextSteps.length > 0 && (
        <div>
          <SectionTitle>下次练习</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {nextSteps.map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 8 }}>
                <span style={{ color: AMBER, fontWeight: 800, flexShrink: 0 }}>{i + 1}.</span>
                <span style={{ wordBreak: "break-word" }}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {focus && (
        <div style={{ padding: "10px 12px", background: AMBER_SOFT, borderLeft: `3px solid ${AMBER}`, borderRadius: 8, fontWeight: 650, color: "#78350F", wordBreak: "break-word" }}>
          {focus}
        </div>
      )}
    </div>
  );
}

/**
 * Inline UI：按钮 + 报告。有缓存则自动回填（不发请求），否则等用户点（点了才计费）。
 *
 * props.items 是练习记录里的 items（{ question, category, transcript, aiScore, recorded }），
 * averageScore / totalElapsed / topic 只是喂给模型的上下文。没有任何有效转写时整块不渲染——
 * 没得分析，不给用户一个点了只会报错的按钮。
 */
export function InterviewAiReviewBlock({ items, averageScore = null, totalElapsed = 0, topic = "", style }) {
  const { reviews, isPro, runReview } = useInterviewAiReview();
  const list = Array.isArray(items) ? items : [];
  const answered = reviewableAnswers(list).length;
  const key = interviewReviewCacheKey(list);
  const state = reviews[key];

  useEffect(() => {
    if (!isPro || answered === 0 || state) return;
    if (getFromCache(key)) runReview(key, { items: list, averageScore, totalElapsed, topic });
    // list 每次渲染都是新引用，但 key 已经把内容摘要进去了；按 key 触发即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPro, answered, key, state, runReview]);

  if (!isPro || answered === 0) return null;

  return (
    <div style={{ borderRadius: 12, border: `1px solid ${AMBER_LINE}`, background: "#fff", overflow: "hidden", ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: AMBER_SOFT, borderBottom: state?.report ? `1px solid ${AMBER_LINE}` : "none" }}>
        <span style={{ fontSize: 14 }}>🤖</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 750, color: TEXT }}>AI 整场分析</div>
          <div style={{ fontSize: 11, color: TEXT_SEC }}>通读 {answered} 段作答，找出反复出现的问题、给出改法和一段改写示范</div>
        </div>
        {!state?.report && (
          <button
            type="button"
            onClick={() => runReview(key, { items: list, averageScore, totalElapsed, topic })}
            disabled={state?.loading}
            style={{
              fontSize: 12, fontWeight: 700, color: "#fff", flexShrink: 0,
              background: state?.loading ? "#9ca3af" : AMBER,
              border: "none", borderRadius: 8, padding: "6px 14px",
              cursor: state?.loading ? "default" : "pointer",
            }}
          >
            {state?.loading ? "分析中…" : state?.error ? "重试" : "开始分析"}
          </button>
        )}
      </div>
      {state?.loading && (
        <div style={{ padding: "10px 14px", fontSize: 12, color: TEXT_DIM }}>AI 正在通读你的 {answered} 段回答，通常需要 20-40 秒…</div>
      )}
      {state?.error && !state?.loading && (
        <div style={{ padding: "10px 14px", fontSize: 12, color: "#E11D48" }}>{state.error}</div>
      )}
      {state?.report && (
        <div style={{ padding: "12px 14px 14px" }}>
          <InterviewAiReviewReport report={state.report} />
        </div>
      )}
    </div>
  );
}
