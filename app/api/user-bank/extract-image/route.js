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
  postProcessRdl,
  postProcessAp,
  postProcessCtw,
  postProcessLcr,
  postProcessLa,
  postProcessLat,
} = require("../../../../lib/ai/prompts/questionExtraction");
const { validateImageBatch } = require("../../../../lib/userBank/imageSniff");

export const maxDuration = 60; // Qwen-VL 典型 3-15s；给 Vercel 留足余量

const limiter = createRateLimiter("user-bank-extract-image", { window: 60_000, max: 10 });
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // **合计** 4 MB（Vercel body ~4.5MB，客户端已下采样）
const MAX_IMAGES = 3; // AP 学术短文常跨 2-3 张截图；单图上传天然向后兼容

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

    const type = String(form.get("type") || ""); // extractor key（academic/email/build/repeat/interview/rdl/ap）
    const userCode = String(form.get("userCode") || "");
    // 1-3 张图（form.getAll 对单图上传返回长度 1 的数组 → 向后兼容旧客户端）。
    const files = form.getAll("image").filter((f) => f && typeof f.arrayBuffer === "function");

    if (!SUPPORTED_IMAGE_TYPES.includes(type)) return jsonError(400, "Invalid type");
    if (files.length === 0) return jsonError(400, "Missing image");

    // Pro + 每日额度门禁：放在付费 VL 调用之前。
    const gate = await gateUserBankRequest({ userCode });
    if (!gate.ok) return Response.json({ error: gate.error, code: gate.code }, { status: gate.status });

    // 未配 key → 优雅 503，前端提示改用粘贴文本（粘贴路径不受影响）。
    if (!process.env.DASHSCOPE_API_KEY) {
      return jsonError(503, "图片识别暂未开通（DASHSCOPE_API_KEY 未配置），请改用粘贴文本。");
    }

    // 逐张 magic-byte 嗅探 + 张数/合计体积门（helper 可单测，路由只做搬运）。
    const buffers = [];
    for (const f of files) buffers.push(Buffer.from(await f.arrayBuffer()));
    const batch = validateImageBatch(buffers, { maxCount: MAX_IMAGES, maxTotalBytes: MAX_IMAGE_BYTES });
    if (!batch.ok) return jsonError(batch.status, batch.error);

    let rawContent;
    try {
      const out = await callQwenVision({
        systemPrompt: IMAGE_EXTRACTION_PROMPTS[type], // 含 SAFETY_PREAMBLE 注入防护
        // callQwenVision 的 imageUrls 本就支持数组（lib/ai/qwenVision.js:40-54）。
        imageUrls: batch.images.map((im) => bufferToDataUrl(im.buffer, im.mime)),
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
    } else if (type === "rdl") {
      questions = questions.map((q) => postProcessRdl(q));
    } else if (type === "ap") {
      questions = questions.map((q) => postProcessAp(q));
    } else if (type === "ctw") {
      // 图片路径语义：传一张含英文段落的资料照片 → Qwen-VL 纯转写文字 → 服务端机械挖空
      //（不是还原已挖空的真题）；产物与粘贴路径完全一致。
      questions = questions.map((q) => postProcessCtw(q));
    } else if (type === "lcr") {
      // 图片语义：LCR 真题界面常只有选项没有口播句 → speaker:"" → postProcessLcr 标 invalid，
      // 引导用户手补口播句（预览不可编辑就改贴文本）。与粘贴路径产物一致。
      questions = questions.map((q) => postProcessLcr(q));
    } else if (type === "la") {
      // 图片语义：LA 真题界面常只有题没公告稿 → announcement:"" → postProcessLa 标 invalid，
      // 引导用户改贴公告文本。机经帖截图（含公告稿+题）则整块抽出。与粘贴路径产物一致。
      questions = questions.map((q) => postProcessLa(q));
    } else if (type === "lat") {
      // 图片语义：LAT 真题界面常只有题没讲座稿 → transcript:"" → postProcessLat 标 invalid，
      // 引导用户改贴讲座文本。机经帖截图（含讲座稿+题）则整块抽出。与粘贴路径产物一致。
      questions = questions.map((q) => postProcessLat(q));
    }

    return Response.json({ ok: true, questions });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
