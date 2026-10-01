import { createRateLimiter, getIp } from "../../../../lib/rateLimit";
const jsonError = (status, error) => Response.json({ ok: false, error }, { status });
import { gateUserBankRequest } from "../../../../lib/userBankAuth";
import { isOriginAllowed } from "../../../../lib/ai/routeGuards";
import { normalizeVocabularyItems, validateVocabularyEntry } from "../../../../lib/vocab/importVocabulary";
const { callQwenVision, bufferToDataUrl } = require("../../../../lib/ai/qwenVision");
const { validateImageBatch } = require("../../../../lib/userBank/imageSniff");
const { VOCAB_EXTRACTION_PROMPT } = require("../../../../lib/ai/prompts/vocabExtraction");
export const maxDuration = 60;
const limiter = createRateLimiter("vocab-extract-image", { window: 60_000, max: 10 });
export async function POST(request) {
  try {
    if (!isOriginAllowed(request)) return jsonError(403, "Forbidden origin.");
    if (limiter.isLimited(getIp(request))) return jsonError(429, "识别请求过于频繁，请稍后重试。");
    const length = Number(request.headers.get("content-length"));
    if (length > 4.4 * 1024 * 1024) return jsonError(413, "图片合计过大，请压缩后重试。");
    const form = await request.formData().catch(() => null);
    if (!form) return jsonError(400, "请选择图片文件。");
    const files = form.getAll("image");
    if (!files.length || files.some((file) => typeof file?.arrayBuffer !== "function")) return jsonError(400, "请选择图片文件。");
    if (files.length > 3 || files.reduce((sum, file) => sum + file.size, 0) > 4 * 1024 * 1024) return jsonError(413, "一次最多 3 张图片，合计最多 4 MB。");
    const buffers = [];
    for (const file of files) buffers.push(Buffer.from(await file.arrayBuffer()));
    const batch = validateImageBatch(buffers, { maxCount: 3, maxTotalBytes: 4 * 1024 * 1024 });
    if (!batch.ok) return jsonError(batch.status, batch.error);
    const gate = await gateUserBankRequest({ userCode: String(form.get("userCode") || "") });
    if (!gate.ok) return Response.json({ ok: false, error: gate.code === "PRO_REQUIRED" ? "图片识别需要 Pro；文本、表格和文字 PDF 可直接导入。" : gate.error, code: gate.code }, { status: gate.status });
    if (!process.env.DASHSCOPE_API_KEY) return jsonError(503, "图片识别暂未开通，请改用粘贴文本或文字文件。");
    let content;
    try { content = (await callQwenVision({ systemPrompt: VOCAB_EXTRACTION_PROMPT, imageUrls: batch.images.map((im) => bufferToDataUrl(im.buffer, im.mime)) }))?.content || ""; }
    catch { return jsonError(502, "图片识别暂不可用，请稍后重试。"); }
    let raw;
    try { raw = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
    catch { return jsonError(422, "图片内容过多或识别不完整，请裁剪为较少词条后重试；尚未导入任何单词。"); }
    if (!Array.isArray(raw) || raw.length > 1000) return jsonError(422, "请裁剪图片为较少词条后重试；尚未导入任何单词。");
    for (const entry of raw) {
      const error = validateVocabularyEntry(entry, { allowNonWords: true });
      if (error) return jsonError(422, `识别结果不完整：${error} 请裁剪为较少词条或改用文字文件；尚未导入任何单词。`);
    }
    const result = normalizeVocabularyItems(raw);
    if (!result.items.length) return jsonError(422, "未识别到明确的单词表，请换一张清晰的词表图片。");
    return Response.json({ ok: true, ...result });
  } catch { return jsonError(500, "无法识别图片，请稍后重试。"); }
}
