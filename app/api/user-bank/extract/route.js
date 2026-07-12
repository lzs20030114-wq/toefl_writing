// 用户自助「粘贴文本 → 抽取题目（预览用）」端点。跑和 admin parse-questions 完全相同的
// DeepSeek 抽取，但门禁换成 user_code + Pro + 每日额度（而非 admin token）。
// 只返回 questions[] 供前端预览，**不落库**——前端预览勾选后再 POST /api/user-bank。
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";
import { jsonError } from "../../../../lib/apiResponse";
import { gateUserBankRequest } from "../../../../lib/userBankAuth";

const { callDeepSeekViaCurl, resolveProxyUrl } = require("../../../../lib/ai/deepseekHttp");
const {
  SYSTEM_PROMPTS,
  isExtractableType,
  extractJson,
  postProcessBuild,
  validateBuildForImport,
  postProcessRepeat,
  postProcessInterview,
  postProcessRdl,
  postProcessAp,
  postProcessCtw,
  postProcessLcr,
  postProcessLa,
  postProcessLat,
  postProcessLc,
} = require("../../../../lib/ai/prompts/questionExtraction");

export const maxDuration = 180;

const limiter = createRateLimiter("user-bank-extract", { window: 60_000, max: 20 });
const MAX_BODY_BYTES = 60000;

// Origin guard copied verbatim from /api/ai (app/api/ai/route.js:34-63).
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

// Same DeepSeek call as parse-questions (each route owns its own call).
async function callDeepSeek(systemPrompt, userText) {
  const payload = {
    model: "deepseek-v4-flash",
    temperature: 0.1,
    max_tokens: 4096,
    stream: false,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText },
    ],
  };

  const proxyUrl = resolveProxyUrl();
  if (proxyUrl) {
    return callDeepSeekViaCurl({
      apiKey: process.env.DEEPSEEK_API_KEY,
      proxyUrl,
      timeoutMs: 60000,
      payload,
    });
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

export async function POST(request) {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return jsonError(413, `Request body too large (>${MAX_BODY_BYTES} bytes).`);
    }
    if (!isOriginAllowed(request)) return jsonError(403, "Forbidden origin.");
    if (limiter.isLimited(getIp(request))) return jsonError(429, "Too many requests");

    const body = await request.json().catch(() => ({}));
    const type = body?.type;
    const text = body?.text;
    if (!type || !text || !String(text).trim()) return jsonError(400, "Missing type or text");

    const gate = await gateUserBankRequest({ userCode: body?.userCode });
    if (!gate.ok) return Response.json({ error: gate.error, code: gate.code }, { status: gate.status });

    if (!process.env.DEEPSEEK_API_KEY) return jsonError(503, "DEEPSEEK_API_KEY not configured");
    if (!isExtractableType(type)) return jsonError(400, "Invalid type");

    const systemPrompt = SYSTEM_PROMPTS[type];
    let rawContent;
    try {
      rawContent = await callDeepSeek(systemPrompt, String(text).trim());
    } catch (e) {
      return jsonError(502, e.message || "Extraction failed");
    }

    let questions;
    try {
      questions = JSON.parse(extractJson(rawContent));
      if (!Array.isArray(questions)) throw new Error("not an array");
    } catch {
      return Response.json(
        { error: "AI returned invalid JSON. Try rephrasing the input.", raw: rawContent.slice(0, 500) },
        { status: 422 }
      );
    }

    if (type === "build") {
      // postProcessBuild fills prefilled_positions/has_question_mark; validateBuildForImport
      // then runs the deterministic distractor-inference + schema fatal gate + ambiguity warning.
      questions = questions.map((q) => validateBuildForImport(postProcessBuild(q)));
    } else if (type === "repeat") {
      questions = questions.map((q) => postProcessRepeat(q));
    } else if (type === "interview") {
      questions = questions.map((q) => postProcessInterview(q));
    } else if (type === "rdl") {
      // Reading: schema gate（选项/题干/答案枚举）标 invalid；词数只进 warnings；variant 服务端派生。
      questions = questions.map((q) => postProcessRdl(q));
    } else if (type === "ap") {
      // Reading: 同上 + paragraphs 服务端从 \n\n 派生 + insert_text 可作答性 + 段号引用检查。
      questions = questions.map((q) => postProcessAp(q));
    } else if (type === "ctw") {
      // Reading CTW（贴原文自动挖空）：AI 只清洗转写，服务端跑 cTestBlanker 机械挖空产出完整 item
      //（答案=原文，天然零错）；词数 <45 标 invalid、>120 只警告；ctwValidator 告警塞进 warnings。
      questions = questions.map((q) => postProcessCtw(q));
    } else if (type === "lcr") {
      // Listening LCR（口播句+4选项+答案）：schema 门（speaker/选项/答案枚举）标 invalid；
      // 答案可缺（verify 用 lcrAuditor 代解）；context/difficulty/answer_paradigm 给缺省；
      // 音频不在这里出——保存后由 /api/user-bank/render-audio 服务端 edge-tts 渲染回写。
      questions = questions.map((q) => postProcessLcr(q));
    } else if (type === "la") {
      // Listening LA（公告稿 + 2 题）：announcement 空/过短标 invalid；词数上限只警告；题数区间外
      //（1-3）只警告；每题 stem/选项缺则剔除；answer 可缺（verify 用 laAuditor 代解）。缺题由 prompt
      // 阶段 AI 已补出 main_idea/detail 各一题（answer=null 交 verify 复核）。
      questions = questions.map((q) => postProcessLa(q));
    } else if (type === "lat") {
      // Listening LAT（讲座稿 + 4-6 题）：transcript 空/过短标 invalid；容真题 800 词/6 题（上限只警告、
      // 题数区间 2-6）；每题 stem/选项缺则剔除；answer 可缺（verify 用 latAuditor 代解）。
      questions = questions.map((q) => postProcessLat(q));
    } else if (type === "lc") {
      // Listening LC（双说话人对话 + 2 题）：speakers 恒 2 且各带 gender（缺则按 name 推断，推不出标
      // invalid）；conversation <4 轮或 <40 词标 invalid、上限只警告；出现名单外说话人（切分错位）标
      // invalid；每题 stem/选项缺则剔除；answer 可缺（verify 用 lcAuditor 代解）。缺题由 prompt 阶段
      // AI 已补 main_idea/detail 各一题。音频（多音色）由保存后 /api/user-bank/render-audio 回写。
      questions = questions.map((q) => postProcessLc(q));
    }

    return Response.json({ ok: true, questions });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
