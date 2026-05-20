/**
 * Client-side helper for /api/speech/transcribe.
 *
 * Wraps the multipart upload + error normalization. Pro tier gating returns a
 * structured 402 from the server; we translate that into a stable `code` the
 * caller can render with the right UI (e.g. "升级 Pro 解锁语音识别") rather
 * than a generic error.
 */

import { getSavedCode } from "../AuthContext";

/**
 * Transcribe an audio blob using the server STT endpoint.
 *
 * @param {Blob}   audio       - the recorded Blob (from MediaRecorder)
 * @param {object} opts
 * @param {"repeat"|"interview"|"mock"} opts.taskType
 * @param {string} [opts.questionId]  - telemetry only
 * @param {number} [opts.durationMs]  - client-reported recording length
 * @param {AbortSignal} [opts.signal]
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   transcript?: string,
 *   words?: Array<{ word: string, start: number, end: number }>,
 *   duration?: number,
 *   latencyMs?: number,
 *   model?: string,
 *   code?: string,   // present when ok=false
 *   error?: string,  // present when ok=false; safe to render
 * }>}
 */
export async function transcribeWithServer(audio, opts = {}) {
  const { taskType, questionId, durationMs, signal } = opts;
  const userCode = (getSavedCode() || "").toUpperCase();
  if (!userCode) {
    return { ok: false, code: "AUTH_REQUIRED", error: "需要登录后才能使用语音识别。" };
  }
  if (!audio || typeof audio.size !== "number" || audio.size === 0) {
    return { ok: false, code: "EMPTY_AUDIO", error: "录音为空。" };
  }

  const form = new FormData();
  // Some browsers default the filename to "blob" — give it a real extension so
  // server-side MIME sniffing works.
  const mime = audio.type || "audio/webm";
  const ext = mime.includes("mp4") ? "m4a"
    : mime.includes("ogg") ? "ogg"
    : mime.includes("wav") ? "wav"
    : mime.includes("mpeg") ? "mp3"
    : "webm";
  form.append("audio", audio, `recording.${ext}`);
  form.append("user_code", userCode);
  form.append("task_type", taskType || "");
  if (questionId) form.append("question_id", String(questionId));
  if (Number.isFinite(durationMs)) form.append("duration_ms", String(durationMs));

  let res;
  try {
    res = await fetch("/api/speech/transcribe", {
      method: "POST",
      body: form,
      signal,
    });
  } catch (e) {
    if (e?.name === "AbortError") return { ok: false, code: "ABORTED", error: "已取消" };
    return { ok: false, code: "NETWORK", error: "无法连接到服务器，请检查网络后重试。" };
  }

  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, code: "INVALID_RESPONSE", error: "服务器返回了无法解析的内容。" };
  }

  if (!res.ok || !body?.ok) {
    return {
      ok: false,
      code: String(body?.code || `HTTP_${res.status}`),
      error: String(body?.error || `服务异常 (HTTP ${res.status})`),
    };
  }

  return {
    ok: true,
    transcript: String(body.transcript || ""),
    words: Array.isArray(body.words) ? body.words : null,
    duration: typeof body.duration === "number" ? body.duration : null,
    latencyMs: typeof body.latency_ms === "number" ? body.latency_ms : null,
    model: body.model || "whisper-1",
  };
}
