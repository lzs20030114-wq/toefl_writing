/**
 * POST /api/speech/transcribe
 *
 * Receives a short audio recording and returns an OpenAI Whisper-1 transcript.
 * Built specifically for our Speaking section — keeps the audio path short and
 * synchronous because all our tasks cap at 45s, well under Whisper's 25 MB /
 * 25 min limits. No async polling, no batch queueing.
 *
 * Why Whisper-1 and not GPT-4o Mini Transcribe:
 *   - Comparable WER on our realistic-disfluency eval (see scripts/test-stt-realistic.mjs)
 *   - 30-50% lower latency in practice
 *   - Supports verbose_json + word-level timestamps, which we want to keep
 *     available for future fluency / pacing scoring
 *
 * Pro tier gate: free users can record but not get transcripts. Recording
 * still saves so the UX doesn't disappear on them — they just see a "Pro 解锁
 * 语音识别" hint instead of a transcript.
 *
 * Body: multipart/form-data
 *   audio        (File)   — required, audio/* MIME, ≤ 2 MB
 *   user_code    (string) — required, 6 chars
 *   task_type    (string) — required, "repeat" | "interview" | "mock"
 *   question_id  (string) — optional, identifier for telemetry only
 *   duration_ms  (number) — optional, client-reported recording length
 *
 * Response:
 *   { ok: true, transcript, words?, duration, latency_ms, model }
 *   { ok: false, code, error }
 */

import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";
import { ProxyAgent, setGlobalDispatcher } from "undici";

// Whisper-1 typically responds in 1-3s for ≤ 60s audio. Vercel hobby caps at
// 60s; we set 60 to give headroom over the ~3s typical and ~10s tail.
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 2 * 1024 * 1024;   // 2 MB — covers 45s mp3 + headroom
const MAX_DURATION_SECONDS = 65;            // 5s headroom over our 60s policy
const ALLOWED_TASK_TYPES = new Set(["repeat", "interview", "mock"]);
const ALLOWED_MIME_PREFIXES = ["audio/"];
// Per-user daily seconds cap. Pro/legacy gets 60 min/day (≈80 questions),
// which covers any realistic study session and stops Pro-trial abuse from
// running up a bill. Set higher per-user via Supabase users.daily_speech_cap
// if needed (column not added yet — wire later).
const DEFAULT_DAILY_CAP_SECONDS = 60 * 60;

// 60 req/min per IP. Our worst-case user does ~10-20 questions per session,
// so 60/min is plenty. Lower than /api/ai's 45 would be okay too but STT
// requests are independent and short.
const limiter = createRateLimiter("speech-transcribe", { window: 60_000, max: 60 });

// Read proxy ONCE at module load. Next.js wraps the global fetch, which means
// passing `dispatcher` as a per-call option gets dropped — we have to install
// the proxy via setGlobalDispatcher so undici's underlying client picks it up.
// Production Vercel won't set these env vars, so this branch is dev-only.
const _proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
console.log(`[/api/speech/transcribe] module load: proxy=${_proxyUrl || "(none)"} apiKey=${process.env.OPENAI_API_KEY ? "set" : "missing"}`);
if (_proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(_proxyUrl));
}

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

function fail(status, code, errorMessage) {
  return Response.json({ ok: false, code, error: errorMessage }, { status });
}

async function logApiFailure(meta) {
  if (!isSupabaseAdminConfigured) return;
  try {
    await supabaseAdmin.from("api_error_feedback").insert({
      endpoint: "/api/speech/transcribe",
      stage: meta.stage || null,
      http_status: Number(meta.httpStatus || 0) || null,
      error_type: String(meta.errorType || "unknown"),
      error_message: String(meta.errorMessage || "").slice(0, 500),
      error_detail: meta.errorDetail ? String(meta.errorDetail).slice(0, 4000) : null,
      client_id: meta.clientId ? String(meta.clientId).slice(0, 120) : null,
      client_ip: meta.clientIp ? String(meta.clientIp).slice(0, 64) : null,
      origin: meta.origin ? String(meta.origin).slice(0, 300) : null,
      user_agent: meta.userAgent ? String(meta.userAgent).slice(0, 500) : null,
    });
  } catch { /* swallow */ }
}

/**
 * Verify user is allowed to call the STT endpoint:
 *   1. Has a valid account
 *   2. Currently Pro (or legacy)
 *   3. Has granted speech consent and not since revoked it
 *
 * Returns specific codes so the client can render the right modal/upsell:
 *   - INVALID_USER   → unknown account
 *   - NOT_PRO        → free tier; show upgrade prompt
 *   - NEEDS_CONSENT  → missing/revoked; show consent modal
 */
async function checkUserEligibility(userCode) {
  if (!isSupabaseAdminConfigured) {
    // Dev fallback: no Supabase = trust client. Production always has it.
    return { ok: true, tier: "unknown" };
  }
  const { data: user, error } = await supabaseAdmin
    .from("users")
    .select("tier, tier_expires_at, speech_consent_at, speech_consent_revoked_at")
    .eq("code", userCode)
    .maybeSingle();
  if (error) return { ok: false, code: "DB_ERROR", message: "无法验证账号" };
  if (!user) return { ok: false, code: "INVALID_USER", message: "无效的用户码" };

  const expired = user.tier_expires_at && new Date(user.tier_expires_at).getTime() <= Date.now();
  const isPro = user.tier === "legacy" || (user.tier === "pro" && !expired);
  if (!isPro) {
    return { ok: false, code: "NOT_PRO", message: "语音识别为 Pro 专属功能" };
  }

  // Consent: must have a grant time, and either no revoke time, or revoke < grant.
  const grantedAt = user.speech_consent_at ? new Date(user.speech_consent_at).getTime() : 0;
  const revokedAt = user.speech_consent_revoked_at ? new Date(user.speech_consent_revoked_at).getTime() : 0;
  const consented = grantedAt > 0 && grantedAt > revokedAt;
  if (!consented) {
    return { ok: false, code: "NEEDS_CONSENT", message: "请先同意语音上传服务条款。" };
  }
  return { ok: true, tier: user.tier };
}

/**
 * Atomically increment today's audio second count and enforce the cap.
 * Uses the increment_speech_usage RPC defined in scripts/sql/speech-stt-schema.sql.
 * Returns { ok: false, code: "DAILY_QUOTA" } if the increment would exceed cap.
 */
async function incrementQuotaOrReject(userCode, seconds, cap) {
  if (!isSupabaseAdminConfigured) {
    return { ok: true, used: 0 }; // dev fallback
  }
  if (seconds <= 0) return { ok: true, used: 0 };
  const { data, error } = await supabaseAdmin.rpc("increment_speech_usage", {
    p_user_code: userCode,
    p_seconds: seconds,
    p_cap: cap,
  });
  if (error) {
    // If the RPC isn't installed yet (pre-migration), allow the call rather
    // than hard-failing — the operator can apply the migration without
    // taking the endpoint offline.
    console.warn("[/api/speech/transcribe] quota RPC error:", error.message);
    return { ok: true, used: -1, rpc_error: error.message };
  }
  const used = Number(data);
  if (used < 0) {
    return { ok: false, code: "DAILY_QUOTA", message: "今日语音识别额度已用尽，请明天再试。" };
  }
  return { ok: true, used };
}

/**
 * Best-effort audio duration estimate in whole seconds.
 * Prefer the client-reported duration_ms (capped to MAX_DURATION_SECONDS) so
 * quota tracking stays consistent even when Whisper's verbose_json `duration`
 * field is slightly off. The client value is bounded by both the form
 * validation and the recorder's hard maxDuration, so it can't be inflated to
 * grief the user's own quota — and even if it were, the cap caps it.
 */
function estimateAudioSeconds(durationMs) {
  const ms = Number(durationMs) || 0;
  if (ms > 0) return Math.min(MAX_DURATION_SECONDS, Math.ceil(ms / 1000));
  // Fall back to half of the max — conservative midpoint for our 30-45s tasks.
  return 30;
}

async function callWhisper(file, openaiKey) {
  // Re-wrap the File so we control the filename + content-type sent to OpenAI.
  // Some browsers send `blob` as the default filename which Whisper rejects.
  const ext = file.name && file.name.includes(".") ? file.name.split(".").pop() : "webm";
  const filename = `audio.${ext}`;

  const upstream = new FormData();
  upstream.append("file", file, filename);
  upstream.append("model", "whisper-1");
  upstream.append("language", "en");
  upstream.append("response_format", "verbose_json");
  upstream.append("timestamp_granularities[]", "word");

  const t0 = Date.now();
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: upstream,
  });
  const latencyMs = Date.now() - t0;

  if (!res.ok) {
    const detail = await res.text();
    const err = new Error(`Whisper HTTP ${res.status}`);
    err.status = res.status;
    err.detail = detail.slice(0, 1000);
    err.latencyMs = latencyMs;
    throw err;
  }

  const json = await res.json();
  return { json, latencyMs };
}

export async function POST(request) {
  const requestMeta = {
    clientIp: getIp(request),
    origin: request.headers.get("origin") || "",
    userAgent: request.headers.get("user-agent") || "",
  };

  try {
    // Origin check — same pattern as /api/ai
    if (!isOriginAllowed(request)) {
      await logApiFailure({ ...requestMeta, stage: "origin", errorType: "forbidden_origin", httpStatus: 403 });
      return fail(403, "FORBIDDEN_ORIGIN", "Forbidden origin.");
    }

    // Rate limit
    const ip = requestMeta.clientIp;
    if (ip && ip !== "unknown" && limiter.isLimited(`ip:${ip}`)) {
      return fail(429, "RATE_LIMITED", "请求过于频繁，请稍后再试。");
    }

    if (!process.env.OPENAI_API_KEY) {
      await logApiFailure({ ...requestMeta, stage: "config", errorType: "missing_key", httpStatus: 500 });
      return fail(500, "MISSING_KEY", "服务端未配置语音识别。");
    }

    // Parse multipart
    let form;
    try {
      form = await request.formData();
    } catch (e) {
      return fail(400, "INVALID_BODY", "请求格式错误。");
    }

    const audio = form.get("audio");
    const userCode = String(form.get("user_code") || "").toUpperCase().trim();
    const taskType = String(form.get("task_type") || "").trim();
    const durationMs = Number(form.get("duration_ms") || 0);

    if (!userCode || userCode.length !== 6) {
      return fail(403, "AUTH_REQUIRED", "需要登录后才能使用语音识别。");
    }
    if (!ALLOWED_TASK_TYPES.has(taskType)) {
      return fail(400, "INVALID_TASK_TYPE", "未知的任务类型。");
    }
    if (!audio || typeof audio === "string") {
      return fail(400, "MISSING_AUDIO", "缺少音频文件。");
    }

    // File-shape validation. In Edge runtime `audio` is a File object.
    if (!ALLOWED_MIME_PREFIXES.some((p) => String(audio.type || "").startsWith(p))) {
      return fail(415, "UNSUPPORTED_FORMAT", `不支持的音频格式：${audio.type || "unknown"}`);
    }
    if (typeof audio.size === "number" && audio.size > MAX_AUDIO_BYTES) {
      return fail(413, "TOO_LARGE", `音频文件过大（>${(MAX_AUDIO_BYTES / 1024 / 1024).toFixed(1)} MB）。`);
    }
    if (typeof audio.size === "number" && audio.size < 1024) {
      // Real recordings are always > 1 KB. Anything smaller is junk.
      return fail(400, "EMPTY_AUDIO", "录音为空或过短。");
    }
    if (durationMs > MAX_DURATION_SECONDS * 1000) {
      return fail(413, "TOO_LONG", `录音超出最大时长 (${MAX_DURATION_SECONDS}s)。`);
    }

    // Pro tier + consent check (one DB hit)
    const eligibility = await checkUserEligibility(userCode);
    if (!eligibility.ok) {
      const statusMap = { NOT_PRO: 402, NEEDS_CONSENT: 451, INVALID_USER: 403, DB_ERROR: 500 };
      const status = statusMap[eligibility.code] || 403;
      return fail(status, eligibility.code, eligibility.message);
    }

    // Atomic daily-quota increment. We charge the user before calling Whisper
    // (vs after) so a 429 racing with another concurrent call can't sneak past
    // the cap. If Whisper later errors, the seconds stay deducted — that's a
    // tiny goodwill cost we accept to keep the abuse-prevention simple.
    const audioSeconds = estimateAudioSeconds(durationMs);
    const quotaResult = await incrementQuotaOrReject(userCode, audioSeconds, DEFAULT_DAILY_CAP_SECONDS);
    if (!quotaResult.ok) {
      return fail(429, quotaResult.code, quotaResult.message);
    }

    // Call Whisper-1
    let whisperRes;
    try {
      whisperRes = await callWhisper(audio, process.env.OPENAI_API_KEY);
    } catch (e) {
      // Surface the upstream error in server logs — Vercel shows these in the
      // function log, and local dev shows them in the terminal. The Supabase
      // logApiFailure path silently no-ops when admin creds aren't set, so
      // without this console.error you'd see only a generic 502 client-side.
      console.error(
        "[/api/speech/transcribe] Whisper failed:",
        e?.status, e?.message, "detail:", String(e?.detail || "").slice(0, 600),
      );
      await logApiFailure({
        ...requestMeta,
        stage: "openai",
        errorType: "vendor_error",
        httpStatus: e.status || 502,
        errorMessage: String(e.message || ""),
        errorDetail: String(e.detail || ""),
      });
      return fail(
        e.status >= 400 && e.status < 500 ? 502 : 502,
        "VENDOR_ERROR",
        "语音识别服务暂时不可用，请稍后重试。",
      );
    }

    const { json, latencyMs } = whisperRes;
    return Response.json({
      ok: true,
      transcript: String(json.text || ""),
      duration: typeof json.duration === "number" ? json.duration : null,
      words: Array.isArray(json.words) ? json.words : null,
      latency_ms: latencyMs,
      model: "whisper-1",
    });
  } catch (e) {
    await logApiFailure({
      ...requestMeta,
      stage: "server",
      errorType: "internal",
      httpStatus: 500,
      errorMessage: String(e?.message || ""),
    });
    return fail(500, "INTERNAL", "服务器内部错误。");
  }
}
