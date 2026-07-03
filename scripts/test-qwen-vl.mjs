#!/usr/bin/env node
/**
 * Phase 0 vendor 验证：拿一张真实的题目截图，看 Qwen3-VL 能不能直接抽出干净的题目 JSON。
 * 对比 qwen3-vl-plus（主力）与 qwen3-vl-flash（便宜兜底）的抽题质量 / 延迟 / 成本，
 * 据此决定默认用哪个、以及 VL-Plus 是否值得多花钱。仿 scripts/test-stt.mjs。
 *
 * 用法（PowerShell）：
 *   $env:DASHSCOPE_API_KEY = "sk-..."
 *   node scripts/test-qwen-vl.mjs path/to/discussion.png academic
 *   node scripts/test-qwen-vl.mjs path/to/email.jpg email
 *
 * 用法（macOS / Linux）：
 *   DASHSCOPE_API_KEY=sk-... node scripts/test-qwen-vl.mjs path/to/img.png academic
 *
 * 第二个参数 type 取 academic | email（默认 academic）。
 * 大陆(北京)endpoint 国内直连，无需代理；若用国际区或需调试，设 HTTPS_PROXY 即可。
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { callQwenVision, bufferToDataUrl, estimateCostUsd, QWEN_VL_MODELS } = require("../lib/ai/qwenVision.js");
const { IMAGE_EXTRACTION_PROMPTS, SUPPORTED_IMAGE_TYPES } = require("../lib/ai/prompts/imageExtraction.js");

// 大陆(北京)DashScope endpoint 是国内域名，必须直连——绝不要走你的「翻墙」代理
// (HTTPS_PROXY=127.0.0.1:10808 那个是给 OpenAI 等境外服务的，把域内流量塞进去会失败)。
// 所以这里默认直连，只有显式设置 DASHSCOPE_PROXY_URL（用国际区时才可能需要）才走代理。
const proxyUrl = process.env.DASHSCOPE_PROXY_URL;
if (proxyUrl) {
  const { ProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.error(`[proxy] using ${proxyUrl}`);
} else if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY) {
  console.error("[proxy] 忽略 HTTPS_PROXY（大陆 DashScope 直连）；如确需代理请设 DASHSCOPE_PROXY_URL");
}

const MIME_BY_EXT = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp", gif: "image/gif", bmp: "image/bmp",
};

const MODELS = ["qwen3-vl-plus", "qwen3-vl-flash"];

function stripFence(s) {
  return String(s || "").replace(/```json/gi, "").replace(/```/g, "").trim();
}

async function run(model, dataUrl, systemPrompt) {
  const t0 = Date.now();
  const { content, usage, latencyMs } = await callQwenVision({
    systemPrompt,
    imageUrls: dataUrl,
    model,
  });
  let parsed = null, parseErr = null;
  try {
    parsed = JSON.parse(stripFence(content));
  } catch (e) {
    parseErr = e.message;
  }
  return { model, content, parsed, parseErr, usage, latencyMs, costUsd: estimateCostUsd(model, usage) };
}

async function main() {
  if (!process.env.DASHSCOPE_API_KEY) {
    console.error("Set DASHSCOPE_API_KEY environment variable.");
    process.exit(1);
  }
  const file = process.argv[2];
  const type = (process.argv[3] || "academic").toLowerCase();
  if (!file) {
    console.error("Usage: node scripts/test-qwen-vl.mjs <image-file> [academic|email]");
    process.exit(1);
  }
  if (!SUPPORTED_IMAGE_TYPES.includes(type)) {
    console.error(`type must be one of: ${SUPPORTED_IMAGE_TYPES.join(", ")}`);
    process.exit(1);
  }

  const absPath = path.resolve(file);
  const buf = await readFile(absPath);
  const st = await stat(absPath);
  const ext = path.extname(absPath).slice(1).toLowerCase();
  const mime = MIME_BY_EXT[ext] || "image/png";
  const dataUrl = bufferToDataUrl(buf, mime);
  const systemPrompt = IMAGE_EXTRACTION_PROMPTS[type];

  console.log();
  console.log("Image:  ", absPath);
  console.log("Size:   ", `${(st.size / 1024).toFixed(1)} KB`);
  console.log("Type:   ", type);
  console.log("─".repeat(72));

  const results = [];
  for (const model of MODELS) {
    process.stdout.write(`\n→ ${model} (${QWEN_VL_MODELS[model]?.note || ""}) ... `);
    try {
      const r = await run(model, dataUrl, systemPrompt);
      results.push(r);
      console.log(`${r.latencyMs} ms`);
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
      results.push({ model, error: e.message });
    }
  }

  console.log("\n" + "═".repeat(72));
  console.log("RESULTS");
  console.log("═".repeat(72));
  for (const r of results) {
    console.log(`\n[${r.model}]`);
    if (r.error) { console.log(`  ❌ ERROR: ${r.error}`); continue; }
    console.log(`  Latency: ${r.latencyMs} ms`);
    if (r.usage) {
      const cost = r.costUsd != null ? `$${r.costUsd.toFixed(5)} ≈ ¥${(r.costUsd * 7.1).toFixed(4)}` : "n/a";
      console.log(`  Tokens:  in ${r.usage.prompt_tokens} / out ${r.usage.completion_tokens}  →  ${cost}  (国际区价；大陆约 1/3)`);
    }
    if (r.parseErr) {
      console.log(`  ⚠️  JSON 解析失败: ${r.parseErr}`);
      console.log(`  Raw:\n${r.content}`);
    } else {
      const n = Array.isArray(r.parsed) ? r.parsed.length : "(非数组)";
      console.log(`  抽到题数: ${n}`);
      console.log(JSON.stringify(r.parsed, null, 2));
    }
  }
  console.log();
}

main().catch((e) => {
  console.error("\nFATAL:", e.message);
  process.exit(1);
});
