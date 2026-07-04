// 个人题库阅读题「答案代解 + 第二考官」端点（rdl/ap 专用，预览阶段逐 item 调用）。
// 两条路径（研究报告 2026-07-04 附录 B 的拍板口径）：
//   (a) item 的 correct_answer 全有 → auditRDLItem 完整复核（DeepSeek 不看标记答案独立作答 +
//       可猜性测试），逐题返回 { verdict: 'ok'|'mismatch', ai_answer, reason }。
//   (b) 有缺失答案 → 只跑 auditor 的独立作答一遍（buildAnswerPrompt），产出 ai_answer 填补，
//       返回 { verdict: 'ai_answered', ai_answer, explanation }；同 item 里用户已标答案的题
//       顺带对比出 ok/mismatch。
// AP 先做 passage→text 字段映射再复用 RDL auditor —— 与 merge 管线同一招
// （scripts/merge-staging.mjs:103、app/reading/page.js:277-290 的"AP 穿 RDL 马甲"口径）。
//
// v1 复核用 DeepSeek 单模（独立作答与复核同模，temperature 0.1）。真正的跨模型二审需要
// DashScope 文本 client —— lib/ai/qwenVision.js 是纯视觉端（callQwenVision 硬性要求至少
// 一张图），仓库尚无文本通道，留作 future work。
//
// fail-open：本端点失败/超时一律不阻塞保存 —— 前端 catch 后把该 item 标灰「未复核」。
// 用户自带答案与 AI 复核不一致时**不静默改**：返回 mismatch，预览黄标让用户点选裁决。
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";
import { jsonError } from "../../../../lib/apiResponse";
import { gateUserBankRequest } from "../../../../lib/userBankAuth";

const { callDeepSeekViaCurl, resolveProxyUrl } = require("../../../../lib/ai/deepseekHttp");
const { auditRDLItem, buildAnswerPrompt, parseJson } = require("../../../../lib/readingGen/answerAuditor");
const { auditLCRItem } = require("../../../../lib/listeningGen/lcrAuditor");
const { auditLAItem } = require("../../../../lib/listeningGen/laAuditor");
const { auditLATItem } = require("../../../../lib/listeningGen/latAuditor");

export const maxDuration = 90; // 路径 (a) 是 2 次串行 DeepSeek 调用（各 ~10-20s）

const limiter = createRateLimiter("user-bank-verify", { window: 60_000, max: 10 });
const MAX_BODY_BYTES = 40000; // 单 item ≤16KB（/api/user-bank 同口径）+ 信封余量
const VALID_ANSWERS = new Set(["A", "B", "C", "D"]);
const MAX_QUESTIONS = 10;

// Origin guard copied verbatim from /api/ai (app/api/ai/route.js:34-63) / user-bank/extract.
function normalizeHost(raw) {
  const input = String(raw || "").trim();
  if (!input) return "";
  try {
    if (input.includes("://")) return new URL(input).host.toLowerCase();
    return new URL(`http://${input}`).host.toLowerCase();
  } catch {
    return input.toLowerCase();
  }
}
function isOriginAllowed(request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    const secFetchSite = request.headers.get("sec-fetch-site");
    if (secFetchSite && secFetchSite !== "none") return false;
    return true;
  }
  const originHost = normalizeHost(origin);
  if (!originHost) return false;
  const host = normalizeHost(request.headers.get("host"));
  const xfh = String(request.headers.get("x-forwarded-host") || "")
    .split(",")
    .map((v) => normalizeHost(v))
    .filter(Boolean);
  return [host, ...xfh].includes(originHost);
}

// Request-scoped DeepSeek call, injected into auditRDLItem（签名对齐 auditor 内建 callAI:
// (prompt, maxTokens) => content string）。仿 /api/user-bank/extract 的调用封装：
// 有代理走 curl，无代理直连 fetch —— auditor 内建的纯 curl client 是给管线脚本用的，
// Vercel 运行时不保证有 curl。
async function verifyCallAI(prompt, maxTokens = 2000) {
  const payload = {
    model: "deepseek-chat",
    temperature: 0.1, // 与 answerAuditor.js:42 对齐——低温才有确定性答案
    max_tokens: maxTokens,
    stream: false,
    messages: [
      {
        role: "system",
        content: "You are a TOEFL reading comprehension expert. Answer precisely and concisely. Return only valid JSON.",
      },
      { role: "user", content: prompt },
    ],
  };

  const proxyUrl = resolveProxyUrl();
  if (proxyUrl) {
    const result = await callDeepSeekViaCurl({
      apiKey: process.env.DEEPSEEK_API_KEY,
      proxyUrl,
      timeoutMs: 30000,
      payload,
    });
    return typeof result === "string" ? result : result?.choices?.[0]?.message?.content || "";
  }

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + process.env.DEEPSEEK_API_KEY,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek API error: ${res.status} — ${errText.slice(0, 200)}`);
  }
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek returned empty content");
  return content;
}

function normAnswer(raw) {
  const s = String(raw == null ? "" : raw).trim().toUpperCase();
  return VALID_ANSWERS.has(s) ? s : null;
}

// LCR verify: normalize the single item, run the independent-answer auditor, and return the
// SAME { results: [...] } envelope the front-end already renders for rdl/ap (one entry here).
// fail-open: any auditor error / bad shape → 400 (bad request) or the caller's catch → 502.
async function verifyLcr(rawItem) {
  const speaker = String(rawItem.speaker || "").trim();
  const rawOpts = rawItem.options && typeof rawItem.options === "object" && !Array.isArray(rawItem.options) ? rawItem.options : null;
  if (!speaker || !rawOpts) return jsonError(400, "LCR item needs a speaker line and options");
  const options = {};
  for (const k of ["A", "B", "C", "D"]) {
    const v = String(rawOpts[k] == null ? "" : rawOpts[k]).trim();
    if (!v) return jsonError(400, "LCR item needs complete A-D options");
    options[k] = v;
  }
  const marked = normAnswer(rawItem.answer);

  // auditLCRItem(item, callAI) → { match, ambiguous, aiAnswer, ... }. It compares aiAnswer to
  // item.answer; when the user hasn't marked one we pass a null answer so match is irrelevant and
  // we drive the verdict off aiAnswer directly.
  const audit = await auditLCRItem({ speaker, options, answer: marked }, (prompt) => verifyCallAI(prompt));
  if (audit.error) return jsonError(502, "复核失败，请稍后重试");

  const ai = normAnswer(audit.aiAnswer);
  let entry;
  if (!ai) {
    entry = { question: "Q1", verdict: "unverified", ai_answer: null, marked_answer: marked };
  } else if (!marked) {
    entry = { question: "Q1", verdict: "ai_answered", ai_answer: ai, marked_answer: null, explanation: String(audit.reasoning || "") };
  } else if (ai === marked) {
    entry = { question: "Q1", verdict: "ok", ai_answer: ai, marked_answer: marked };
  } else {
    entry = { question: "Q1", verdict: "mismatch", ai_answer: ai, marked_answer: marked, reason: String(audit.reasoning || "") };
  }
  return Response.json({ ok: true, results: [entry] });
}

// LA/LAT verify: announcement/transcript + multi-question MCQ. Runs the existing la/lat auditor
// (callAI injected) — it independently answers EACH question and returns a details[] array. We map
// that array into the SAME { results: [...] } envelope the front-end renders for rdl/ap (one entry
// per question, aligned to details[qi]). answer may be null per question (verify 代解).
async function verifyListening(rawItem, auditItem, textField) {
  const body = String(rawItem[textField] || "").trim();
  const rawQuestions = Array.isArray(rawItem.questions) ? rawItem.questions : [];
  if (!body || rawQuestions.length === 0) {
    return jsonError(400, "item must include the announcement/transcript and at least one question");
  }
  if (rawQuestions.length > MAX_QUESTIONS) return jsonError(400, `Too many questions (max ${MAX_QUESTIONS})`);

  const questions = [];
  const marked = [];
  for (const q of rawQuestions) {
    const stem = String(q?.stem || "").trim();
    const opts = q?.options && typeof q.options === "object" && !Array.isArray(q.options) ? q.options : null;
    if (!stem || !opts) return jsonError(400, "Each question needs a stem and options");
    const options = {};
    for (const k of ["A", "B", "C", "D"]) {
      const v = String(opts[k] == null ? "" : opts[k]).trim();
      if (!v) return jsonError(400, "Each question needs complete A-D options");
      options[k] = v;
    }
    const m = normAnswer(q?.answer);
    marked.push(m);
    // The auditor compares aiAnswer to q.answer; pass the marked answer through so `match` is
    // meaningful when present (null → match irrelevant, verdict driven off aiAnswer).
    questions.push({ type: q?.type, stem, options, answer: m });
  }

  const audit = await auditItem({ [textField]: body, questions }, (prompt) => verifyCallAI(prompt));
  if (audit.error || !Array.isArray(audit.details)) return jsonError(502, "复核失败，请稍后重试");

  const results = questions.map((_, i) => {
    const d = audit.details.find((r) => r.questionIndex === i) || audit.details[i];
    const ai = normAnswer(d && d.aiAnswer);
    const reasoning = String((d && d.reasoning) || "");
    const key = `Q${i + 1}`;
    if (!ai) return { question: key, verdict: "unverified", ai_answer: null, marked_answer: marked[i] };
    if (!marked[i]) return { question: key, verdict: "ai_answered", ai_answer: ai, marked_answer: null, explanation: reasoning };
    if (ai === marked[i]) return { question: key, verdict: "ok", ai_answer: ai, marked_answer: marked[i] };
    return { question: key, verdict: "mismatch", ai_answer: ai, marked_answer: marked[i], reason: reasoning };
  });
  return Response.json({ ok: true, results });
}

export async function POST(request) {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return jsonError(413, `Request body too large (>${MAX_BODY_BYTES} bytes).`);
    }
    if (!isOriginAllowed(request)) return jsonError(403, "Forbidden origin.");
    if (limiter.isLimited(getIp(request))) return jsonError(429, "Too many requests");

    const body = await request.json().catch(() => ({}));
    const type = String(body?.type || "");
    if (!["rdl", "ap", "lcr", "la", "lat"].includes(type)) return jsonError(400, "Invalid type");
    const rawItem = body?.item;
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      return jsonError(400, "Missing item");
    }

    // 与 extract 完全相同的门禁（Pro + 每日活动上限），放在付费 AI 调用之前。
    const gate = await gateUserBankRequest({ userCode: body?.userCode });
    if (!gate.ok) return Response.json({ error: gate.error, code: gate.code }, { status: gate.status });

    if (!process.env.DEEPSEEK_API_KEY) return jsonError(503, "DEEPSEEK_API_KEY not configured");

    // ── LCR (听力选择回应): one item = one question (speaker + 4 options + answer). Uses the
    // existing lcrAuditor's independent-answer pass (callAI injected). Two口径 mirror rdl/ap:
    //   answer present → auditLCRItem 复核（AI 独立选 best）→ ok / mismatch。
    //   answer missing → same call, aiAnswer 填补 → verdict "ai_answered".
    if (type === "lcr") {
      return await verifyLcr(rawItem);
    }

    // ── LA (听公告) / LAT (学术讲座): announcement/transcript + multi-question MCQ. Uses the
    // la/lat auditor's independent-answer pass (callAI injected), mapped to the rdl/ap results
    // envelope. Same两口径: answer present → ok/mismatch; missing → ai_answered.
    if (type === "la") return await verifyListening(rawItem, auditLAItem, "announcement");
    if (type === "lat") return await verifyListening(rawItem, auditLATItem, "transcript");

    // AP 穿 RDL 马甲：passage → text，之后全程按 RDL item 处理。
    const text = String((type === "ap" ? rawItem.passage : rawItem.text) || "").trim();
    const rawQuestions = Array.isArray(rawItem.questions) ? rawItem.questions : [];
    if (!text || rawQuestions.length === 0) {
      return jsonError(400, "item must include the passage text and at least one question");
    }
    if (rawQuestions.length > MAX_QUESTIONS) return jsonError(400, `Too many questions (max ${MAX_QUESTIONS})`);
    const questions = [];
    for (const q of rawQuestions) {
      const stem = String(q?.stem || "").trim();
      const opts = q?.options && typeof q.options === "object" ? q.options : null;
      if (!stem || !opts) return jsonError(400, "Each question needs a stem and options");
      const options = {};
      for (const k of ["A", "B", "C", "D"]) {
        const v = String(opts[k] == null ? "" : opts[k]).trim();
        if (!v) return jsonError(400, "Each question needs complete A-D options");
        options[k] = v;
      }
      questions.push({ question_type: q?.question_type, stem, options, correct_answer: normAnswer(q?.correct_answer) });
    }

    const marked = questions.map((q) => q.correct_answer);
    const hasAllAnswers = marked.every(Boolean);

    let results;
    if (hasAllAnswers) {
      // (a) 答案全有 → auditRDLItem 完整复核（独立作答 + 可猜性；GUESSABLE 对个人题只忽略）。
      const audit = await auditRDLItem({ id: rawItem.id || "verify_probe", text, questions }, verifyCallAI);
      if (audit.error || !Array.isArray(audit.results)) {
        return jsonError(502, "复核失败，请稍后重试"); // 前端 fail-open：标「未复核」
      }
      results = audit.results.map((r, i) => {
        const ai = normAnswer(r.aiAnswer);
        if (!ai) return { question: `Q${i + 1}`, verdict: "unverified", ai_answer: null, marked_answer: marked[i] };
        if (r.match) return { question: `Q${i + 1}`, verdict: "ok", ai_answer: ai, marked_answer: marked[i] };
        const mismatch = (r.flags || []).find((f) => f.type === "ANSWER_MISMATCH");
        return {
          question: `Q${i + 1}`,
          verdict: "mismatch",
          ai_answer: ai,
          marked_answer: marked[i],
          reason: String(mismatch?.detail || ""),
        };
      });
    } else {
      // (b) 有缺失答案 → 独立作答一遍产出 ai_answer 填补；已标答案的题顺带对比。
      const raw = await verifyCallAI(buildAnswerPrompt(text, questions));
      const parsed = parseJson(raw);
      results = questions.map((q, i) => {
        const key = `Q${i + 1}`;
        const entry = parsed?.[key];
        const ai = normAnswer(entry && typeof entry === "object" ? entry.answer : entry);
        const reasoning = entry && typeof entry === "object" ? String(entry.reasoning || "") : "";
        if (!ai) return { question: key, verdict: "unverified", ai_answer: null, marked_answer: marked[i] };
        if (marked[i]) {
          if (ai === marked[i]) return { question: key, verdict: "ok", ai_answer: ai, marked_answer: marked[i] };
          return { question: key, verdict: "mismatch", ai_answer: ai, marked_answer: marked[i], reason: reasoning };
        }
        return { question: key, verdict: "ai_answered", ai_answer: ai, marked_answer: null, explanation: reasoning };
      });
    }

    return Response.json({ ok: true, results });
  } catch (e) {
    // fail-open 由前端兜：这里 502，前端 catch 后标「未复核」，不阻塞保存。
    return jsonError(502, e.message || "复核失败，请稍后重试");
  }
}
