/**
 * 通义千问 Qwen3-VL 视觉客户端 —— 把题库图片送给视觉模型，让它直接吐原生题目 JSON。
 *
 * 为什么是它：OpenAI/Claude/Gemini 封锁中国大陆+香港（含 Vercel hkg1），不能进
 * 面向中国用户的运行时；Qwen3-VL 大陆(北京)endpoint 国内直连、数据境内、无需代理，
 * 且是 OpenAI 兼容接口（chat/completions + image_url content block），接法跟现有
 * OpenAI 客户端几乎一样。见 data/claudeGen/reports/USER-UPLOAD-QUESTIONBANK-RESEARCH-2026-06-23.md。
 *
 * 纯文本无依赖（native fetch / Node 18+）。可被 API 路由 require()，也可被 .mjs 脚本 import。
 */

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"; // 大陆(北京)，国内直连
const DEFAULT_MODEL = "qwen3-vl-plus";

// 选型见报告：VL 系列视觉专精，最对口「看清小字 + 理解题干/选项/空格结构」。
// 价格为国际区(USD/1M tokens, 0-32K 档)，大陆区约便宜 3 倍、批量再 5 折——量级用于成本估算。
const QWEN_VL_MODELS = {
  "qwen3-vl-plus":  { inUsdPerM: 0.2,  outUsdPerM: 1.6, note: "主力：文档/中文 OCR 最稳" },
  "qwen3-vl-flash": { inUsdPerM: 0.05, outUsdPerM: 0.4, note: "兜底：最便宜，简单页够用" },
  "qwen3.5-plus":   { inUsdPerM: 0.4,  outUsdPerM: 2.4, note: "升级：1M 上下文，多页/复杂版面" },
};

function resolveBaseUrl() {
  return (process.env.DASHSCOPE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/** data:image/png;base64,... 或可公开访问的 http(s) 图片 URL 都可。 */
function bufferToDataUrl(buffer, mime = "image/png") {
  const b64 = Buffer.isBuffer(buffer) ? buffer.toString("base64") : Buffer.from(buffer).toString("base64");
  return `data:${mime};base64,${b64}`;
}

/**
 * 调用 Qwen3-VL，返回 { content, usage, latencyMs }。
 * content 是模型输出的原始字符串（通常是 JSON 数组，调用方负责 stripFence + JSON.parse）。
 *
 * @param {object} opts
 * @param {string} opts.systemPrompt     —— 抽题 system prompt（见 lib/ai/prompts/imageExtraction.js）
 * @param {string} [opts.userText]       —— 可选附加文字说明
 * @param {string|string[]} opts.imageUrls —— 一或多张图：data URL 或 http(s) URL
 * @param {string} [opts.model]          —— 默认 qwen3-vl-plus
 * @param {number} [opts.timeoutMs]      —— 默认 60s
 */
async function callQwenVision({ systemPrompt, userText, imageUrls, model, timeoutMs = 60000 }) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY is not set");
  if (!imageUrls || (Array.isArray(imageUrls) && imageUrls.length === 0)) {
    throw new Error("callQwenVision: at least one image is required");
  }

  const images = Array.isArray(imageUrls) ? imageUrls : [imageUrls];
  const userContent = [
    ...(userText ? [{ type: "text", text: userText }] : []),
    ...images.map((url) => ({ type: "image_url", image_url: { url } })),
  ];

  const payload = {
    model: model || process.env.QWEN_VL_MODEL || DEFAULT_MODEL,
    temperature: 0.1,
    max_tokens: 4096,
    stream: false,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(`${resolveBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Qwen-VL HTTP ${res.status}: ${errText.slice(0, 500)}`);
    }
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content || "";
    return { content, usage: json?.usage || null, latencyMs, model: payload.model };
  } finally {
    clearTimeout(timer);
  }
}

/** 估算单次调用成本（美元）。usage = {prompt_tokens, completion_tokens}。 */
function estimateCostUsd(model, usage) {
  const p = QWEN_VL_MODELS[model];
  if (!p || !usage) return null;
  const inUsd = ((usage.prompt_tokens || 0) / 1e6) * p.inUsdPerM;
  const outUsd = ((usage.completion_tokens || 0) / 1e6) * p.outUsdPerM;
  return inUsd + outUsd;
}

module.exports = {
  callQwenVision,
  bufferToDataUrl,
  estimateCostUsd,
  QWEN_VL_MODELS,
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
};
