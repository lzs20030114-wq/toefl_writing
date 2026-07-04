// 个人题库听力配音端点（best-effort，绝不阻塞练习）。
//
// POST { userCode, itemId } → 读该用户该条听力题 → 用 edge-tts 渲染口播文本 →
// 传到 listening_audio/user/{CODE}/{item_id}-{ts}.mp3（文件名带时间戳保证唯一，
// 满足 /api/audio 代理 immutable 缓存要求：重渲染必须换名）→ 回写该行 data.audio_url →
// 返回 { ok:true, audio_url }。
//
// 拍板口径（写进代码）：
//   * 音频全程 best-effort：任何一步失败都返回 { ok:false, reason }，前端不阻塞——
//     没有 audio_url 时 AudioPlayer 自动用浏览器 speechSynthesis 念 speaker 文本
//     （AudioPlayer.js:16-27,109-116）。所以配音失败 = 浏览器朗读，功能仍可用。
//   * 引擎 = edge-tts（免费；gpt-4o-mini-tts 付费引擎留 future）。
//   * 防滥用 v1 = 限流 8/min（每日渲染帽留 future 注释）。
//   * 存储的 audio_url = uploadAudio 返回的 Supabase 公有桶 URL；播放时 AudioPlayer 的
//     sameOriginAudio 会把它重写成 /api/audio/…（国内可达）。见 lib/listening/audioSrc.js。
//   * spike 已证 edge-tts 在纯 Node 无脚本环境可用内存 Buffer 直出 mp3
//     （scripts/spike-edge-tts.mjs，~2s / ~45KB）——所以走内存 Buffer，不落盘。
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";
import { jsonError } from "../../../../lib/apiResponse";
import { gateUserBankRequest } from "../../../../lib/userBankAuth";

const { generateSpeech } = require("../../../../lib/tts/edgeTts");
const { uploadAudio } = require("../../../../lib/tts/storage");

export const maxDuration = 60; // edge-tts 单句 ~2s；给 Vercel + 上传留足余量

const limiter = createRateLimiter("user-bank-render-audio", { window: 60_000, max: 8 });

// Listening types this endpoint can render, and how to pull the spoken text from data.
// Written as a map so LA/LC/LAT can be added later (announcement / conversation / transcript).
const LISTENING_TEXT_EXTRACTORS = {
  lcr: (data) => String(data?.speaker || "").trim(),
};

// Edge voice preset per type (single-speaker rendering; LC's two-voice path is future work).
const LISTENING_PRESET = {
  lcr: "lcr_campus_female",
};

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

// Uniform best-effort failure: 200 with { ok:false, reason } so the front-end never treats a
// missing recording as an error (it just leaves the item on browser-TTS).
function softFail(reason) {
  return Response.json({ ok: false, reason });
}

export async function POST(request) {
  try {
    if (!isOriginAllowed(request)) return jsonError(403, "Forbidden origin.");
    if (limiter.isLimited(getIp(request))) return jsonError(429, "Too many requests");
    if (!isSupabaseAdminConfigured) return softFail("storage not configured");

    const body = await request.json().catch(() => ({}));
    const itemId = String(body?.itemId || "").trim();
    if (!itemId) return jsonError(400, "itemId is required");

    // Same Pro + daily-activity gate as extract, before any work.
    const gate = await gateUserBankRequest({ userCode: body?.userCode });
    if (!gate.ok) return Response.json({ error: gate.error, code: gate.code }, { status: gate.status });
    const code = gate.userCode;

    // Read the row scoped to this user (+item_id) — the .eq(user_code) is the IDOR fence.
    const { data: row, error } = await supabaseAdmin
      .from("user_question_banks")
      .select("id,item_id,type,data")
      .eq("user_code", code)
      .eq("item_id", itemId)
      .maybeSingle();
    if (error || !row) return softFail("item not found");

    const extractText = LISTENING_TEXT_EXTRACTORS[row.type];
    if (!extractText) return softFail(`type "${row.type}" has no audio`);
    const text = extractText(row.data);
    if (!text) return softFail("no spoken text to render");

    // Render (edge-tts, in-memory Buffer — proven by scripts/spike-edge-tts.mjs).
    let buffer;
    try {
      buffer = await generateSpeech(text, { preset: LISTENING_PRESET[row.type] || "default", format: "mp3" });
    } catch (e) {
      return softFail(`tts failed: ${(e && e.message) || "unknown"}`);
    }
    if (!buffer || !buffer.length) return softFail("tts produced no audio");

    // Unique filename (timestamp) so a re-render never collides with the /api/audio immutable
    // cache (max-age=31536000). Path stays under this user's own prefix.
    const storagePath = `user/${code}/${itemId}-${Date.now()}.mp3`;
    let publicUrl;
    try {
      const up = await uploadAudio(storagePath, buffer);
      publicUrl = up && up.url;
    } catch (e) {
      return softFail(`upload failed: ${(e && e.message) || "unknown"}`);
    }
    if (!publicUrl) return softFail("upload produced no url");

    // Write audio_url back into data. Store the raw bucket URL uploadAudio returned — AudioPlayer's
    // sameOriginAudio rewrites it to /api/audio/… at play time (国内可达). Merge, don't overwrite data.
    const nextData = { ...(row.data && typeof row.data === "object" ? row.data : {}), audio_url: publicUrl };
    const { error: upErr } = await supabaseAdmin
      .from("user_question_banks")
      .update({ data: nextData })
      .eq("user_code", code)
      .eq("item_id", itemId);
    if (upErr) return softFail(`db write failed: ${upErr.message}`);

    return Response.json({ ok: true, audio_url: publicUrl });
  } catch (e) {
    // Best-effort contract: even an unexpected error is a soft fail (browser TTS covers it).
    return softFail((e && e.message) || "unexpected error");
  }
}
