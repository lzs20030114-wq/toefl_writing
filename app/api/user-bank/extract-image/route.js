// 用户自助「上传图片 → 识别题目（预览用）」端点。用 Qwen3-VL 视觉直出原生 JSON，
// 门禁与 /api/user-bank/extract 完全一致（user_code + Pro + 每日额度），只是把纯文本换成图片。
// 只返回 questions[] 供前端预览，**不落库**——图片仅内存转 data URL，绝不落盘（绕开存储安全面）。
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";
import { jsonError } from "../../../../lib/apiResponse";
import { gateUserBankRequest } from "../../../../lib/userBankAuth";

const { callQwenVision, bufferToDataUrl } = require("../../../../lib/ai/qwenVision");
const { IMAGE_EXTRACTION_PROMPTS, SUPPORTED_IMAGE_TYPES } = require("../../../../lib/ai/prompts/imageExtraction");
const {
  extractJson,
  postProcessBuild,
  validateBuildForImport,
  postProcessRepeat,
  postProcessInterview,
} = require("../../../../lib/ai/prompts/questionExtraction");
const { sniffImageMime } = require("../../../../lib/userBank/imageSniff");

export const maxDuration = 60; // Qwen-VL 典型 3-15s；给 Vercel 留足余量

const limiter = createRateLimiter("user-bank-extract-image", { window: 60_000, max: 10 });
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB（Vercel body ~4.5MB，客户端已下采样）

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

export async function POST(request) {
  try {
    if (!isOriginAllowed(request)) return jsonError(403, "Forbidden origin.");
    if (limiter.isLimited(getIp(request))) return jsonError(429, "Too many requests");

    const form = await request.formData().catch(() => null);
    if (!form) return jsonError(400, "Expected multipart/form-data");

    const type = String(form.get("type") || ""); // 'academic' | 'email'（extractor key）
    const userCode = String(form.get("userCode") || "");
    const file = form.get("image");

    if (!SUPPORTED_IMAGE_TYPES.includes(type)) return jsonError(400, "Invalid type");
    if (!file || typeof file.arrayBuffer !== "function") return jsonError(400, "Missing image");

    // Pro + 每日额度门禁：放在付费 VL 调用之前。
    const gate = await gateUserBankRequest({ userCode });
    if (!gate.ok) return Response.json({ error: gate.error, code: gate.code }, { status: gate.status });

    // 未配 key → 优雅 503，前端提示改用粘贴文本（粘贴路径不受影响）。
    if (!process.env.DASHSCOPE_API_KEY) {
      return jsonError(503, "图片识别暂未开通（DASHSCOPE_API_KEY 未配置），请改用粘贴文本。");
    }

    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length === 0) return jsonError(400, "Empty image");
    if (buf.length > MAX_IMAGE_BYTES) {
      return jsonError(413, `图片过大（>${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB），请压缩后重试`);
    }
    const mime = sniffImageMime(buf);
    if (!mime) return jsonError(415, "仅支持 JPEG / PNG / WebP 图片");

    let rawContent;
    try {
      const out = await callQwenVision({
        systemPrompt: IMAGE_EXTRACTION_PROMPTS[type], // 含 SAFETY_PREAMBLE 注入防护
        imageUrls: bufferToDataUrl(buf, mime),
      });
      rawContent = out?.content || "";
    } catch (e) {
      return jsonError(502, (e && e.message) || "图片识别服务暂不可用，请稍后重试");
    }

    let questions;
    try {
      questions = JSON.parse(extractJson(rawContent));
      if (!Array.isArray(questions)) throw new Error("not an array");
    } catch {
      return Response.json(
        { error: "图片识别返回格式异常，请换张更清晰的截图重试。", raw: String(rawContent).slice(0, 500) },
        { status: 422 }
      );
    }

    // 与粘贴路径对齐：build/repeat/interview 类型需服务端补算（难度/词数确定性推导）。
    if (type === "build") {
      // Same as the paste path: postProcessBuild backfills, then validateBuildForImport does the
      // deterministic distractor-inference + schema fatal gate + ambiguity warning.
      questions = questions.map((q) => validateBuildForImport(postProcessBuild(q)));
    } else if (type === "repeat") {
      questions = questions.map((q) => postProcessRepeat(q));
    } else if (type === "interview") {
      questions = questions.map((q) => postProcessInterview(q));
    }

    return Response.json({ ok: true, questions });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
