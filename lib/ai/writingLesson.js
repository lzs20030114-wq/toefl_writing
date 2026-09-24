import { getSavedCode } from "../AuthContext";
import { resolveClientId } from "./client";
import { parseLesson } from "./lessonParse";

// 讲评(lesson)的客户端入口。评分完成、报告已经上屏之后才发这一次请求 ——
// 失败/超时/解析不过一律静默降级：报告照常显示，只是没有讲评区块。

const MAX_ANNOTATIONS = 25;
// lesson 会被写回 session(localStorage / Supabase sessions.details)，raw 全文留着会
// 把每条记录撑大好几 KB；只留一截够排查即可。
const MAX_RAW_CHARS = 4000;

function clampText(value, max) {
  const v = String(value || "").trim();
  return v.length > max ? v.slice(0, max) : v;
}

// 从评分报告里挑白名单字段发给服务端。**不是**把整个 report 扔过去：report 里还有
// annotationSegments / sections / sectionStates 这些对讲评毫无用处的大字段，它们既撑爆
// 请求体上限(20000 字符)，也会稀释模型注意力。
export function pickLessonInputs(report) {
  const r = report && typeof report === "object" ? report : {};
  const out = {};

  if (Number.isFinite(Number(r.score))) out.score = Number(r.score);
  if (r.band != null && String(r.band).trim()) out.band = String(r.band).trim();

  const dims = r?.rubric?.dimensions;
  if (dims && typeof dims === "object") {
    const picked = {};
    ["task_fulfillment", "organization_coherence", "language_use"].forEach((key) => {
      const d = dims[key];
      if (!d || typeof d !== "object") return;
      picked[key] = {
        score: Number.isFinite(Number(d.score)) ? Number(d.score) : null,
        reason: String(d.reason || "").trim(),
      };
    });
    if (Object.keys(picked).length > 0) out.rubric = { dimensions: picked };
  }

  if (r.signals && typeof r.signals === "object") {
    out.signals = {
      stance_clear: r.signals.stance_clear ?? null,
      has_example: r.signals.has_example ?? null,
      engages_discussion: r.signals.engages_discussion ?? null,
    };
  }

  if (Array.isArray(r.goals) && r.goals.length > 0) {
    out.goals = r.goals.map((g) => ({
      index: Number(g?.index) || 0,
      status: String(g?.status || "").toUpperCase(),
      reason: String(g?.reason || "").trim(),
    }));
  }

  if (r.errorTriage && typeof r.errorTriage === "object") {
    out.errorTriage = {
      capped: (Array.isArray(r.errorTriage.capped) ? r.errorTriage.capped : []).map((c) => ({
        quote: String(c?.quote || "").trim(),
        issue: String(c?.issue || "").trim(),
        impedes: c?.impedes ?? null,
        systemic: c?.systemic ?? null,
      })),
      minorSummary: String(r.errorTriage.minorSummary || "").trim(),
    };
  }

  if (Array.isArray(r.patterns) && r.patterns.length > 0) {
    out.patterns = r.patterns.map((p) => ({
      tag: String(p?.tag || "").trim(),
      count: Number(p?.count) || 0,
      summary: String(p?.summary || "").trim(),
    }));
  }

  const modelEssay = String(r?.comparison?.modelEssay || "").trim();
  if (modelEssay) out.modelEssay = modelEssay;

  const plainText = String(r?.annotationParsed?.plainText || "");
  const annotations = Array.isArray(r?.annotationParsed?.annotations) ? r.annotationParsed.annotations : [];
  if (annotations.length > 0) {
    out.annotations = annotations.slice(0, MAX_ANNOTATIONS).map((a) => ({
      level: String(a?.level || ""),
      text:
        Number.isInteger(a?.start) && Number.isInteger(a?.end) && a.end > a.start
          ? plainText.slice(a.start, a.end)
          : "",
      fix: String(a?.fix || "").trim(),
      message: String(a?.message || "").trim(),
    }));
  }

  return out;
}

export async function generateWritingLesson(type, pd, text, report, { timeoutMs = 120000 } = {}) {
  const controller = new AbortController();
  let timeoutId;
  const clientId = resolveClientId();
  try {
    const requestPromise = (async () => {
      const body = {
        userCode: getSavedCode() || "",
        type: type === "email" ? "email" : "discussion",
        promptData: pd || null,
        userText: String(text || ""),
        report: pickLessonInputs(report),
      };
      const r = await fetch("/api/ai/lesson", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(clientId ? { "X-Client-Id": clientId } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        let respBody = null;
        try { respBody = await r.json(); } catch {}
        const err = new Error("Lesson API error " + r.status);
        err.status = r.status;
        err.code = respBody && respBody.code ? String(respBody.code) : "";
        err.serverMessage = respBody && respBody.error ? String(respBody.error) : "";
        throw err;
      }
      const d = await r.json();
      if (d?.error) throw new Error(d.error);
      const content = String(d?.content || "");
      if (!content.trim()) throw new Error("Empty lesson response");
      const lesson = parseLesson(content);
      if (!lesson.ok) {
        const err = new Error("Lesson parse failed");
        err.reason = "parse_failed";
        throw err;
      }
      return { ...lesson, raw: clampText(lesson.raw, MAX_RAW_CHARS) };
    })();

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error("Lesson API timeout"));
      }, timeoutMs);
    });

    return await Promise.race([requestPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}
