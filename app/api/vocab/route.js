import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../lib/rateLimit";
import { jsonError } from "../../../lib/apiResponse";

/**
 * 单词本的云端副本。
 *
 * 本地 localStorage 才是真源（见 lib/vocab/vocabStore.js），这里只是跨设备的
 * 一份镜像：整张卡片以 JSONB 存，因为 SRS 字段以后还会变（换权重、加卡片方向），
 * 每加一个字段就跑一次迁移不值当。word 和 updated_at 提成列，供去重与增量合并。
 */

const TABLE = "vocab_cards";
const MAX_CARDS_PER_REQUEST = 100;
const CARD_MAX_BYTES = 4 * 1024;
const WORD_MAX_LEN = 60;

// 复习时每打一次分就 debounce 后同步一次，一次同步最多 N 个批次请求；
// 90/min 够一场几百词的复习加几次重试。
const limiter = createRateLimiter("vocab", { window: 60_000, max: 90 });

function normalizeCode(raw) {
  return String(raw || "").toUpperCase().trim();
}

/** 校验并收拾一张要写进云端的卡。返回 { row } 或 { error }。 */
function toRow(code, raw) {
  if (!raw || typeof raw !== "object") return { error: "card must be an object" };
  const word = String(raw.word || "").trim().toLowerCase();
  if (!word) return { error: "card.word is required" };
  if (word.length > WORD_MAX_LEN) return { error: `card.word too long (>${WORD_MAX_LEN})` };

  let bytes;
  try {
    bytes = JSON.stringify(raw).length;
  } catch {
    return { error: "card is not JSON-serializable" };
  }
  if (bytes > CARD_MAX_BYTES) return { error: `card too large (${bytes} > ${CARD_MAX_BYTES} bytes)` };

  const updatedAt = raw.updatedAt && !Number.isNaN(new Date(raw.updatedAt).getTime())
    ? new Date(raw.updatedAt).toISOString()
    : new Date().toISOString();

  return {
    row: {
      user_code: code,
      word,
      card: { ...raw, word, updatedAt },
      updated_at: updatedAt,
    },
  };
}

export async function GET(request) {
  try {
    if (limiter.isLimited(getIp(request))) return jsonError(429, "Too many requests");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const url = new URL(request.url);
    const code = normalizeCode(url.searchParams.get("code"));
    if (!code) return jsonError(400, "code is required");

    const limit = Math.min(3000, Math.max(1, Number(url.searchParams.get("limit") || 3000)));

    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select("word,card,updated_at")
      .eq("user_code", code)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) return jsonError(400, error.message || "Load vocab failed");

    // 以行上的 updated_at 为准回填进卡片，免得客户端拿到的 updatedAt 和行不一致。
    const cards = (data || []).map((r) => ({ ...(r.card || {}), word: r.word, updatedAt: r.updated_at }));
    return Response.json({ ok: true, cards });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}

export async function POST(request) {
  try {
    if (limiter.isLimited(getIp(request))) return jsonError(429, "Too many requests");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const body = await request.json().catch(() => ({}));
    const code = normalizeCode(body?.code);
    if (!code) return jsonError(400, "code is required");

    const cards = Array.isArray(body?.cards) ? body.cards : null;
    if (!cards || cards.length === 0) return jsonError(400, "cards must be a non-empty array");
    if (cards.length > MAX_CARDS_PER_REQUEST) {
      return jsonError(400, `too many cards (${cards.length} > ${MAX_CARDS_PER_REQUEST})`);
    }

    const rows = [];
    const seen = new Set();
    for (const raw of cards) {
      const { row, error } = toRow(code, raw);
      if (error) return jsonError(400, error);
      // 同一次请求里重复的词会让 upsert 报 21000，先在这儿去重（留最后一个）。
      if (seen.has(row.word)) {
        rows[rows.findIndex((r) => r.word === row.word)] = row;
      } else {
        seen.add(row.word);
        rows.push(row);
      }
    }

    const { error } = await supabaseAdmin
      .from(TABLE)
      .upsert(rows, { onConflict: "user_code,word" });
    if (error) return jsonError(400, error.message || "Save vocab failed");

    return Response.json({ ok: true, saved: rows.length });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}

export async function DELETE(request) {
  try {
    if (limiter.isLimited(getIp(request))) return jsonError(429, "Too many requests");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const url = new URL(request.url);
    const code = normalizeCode(url.searchParams.get("code"));
    if (!code) return jsonError(400, "code is required");

    const word = String(url.searchParams.get("word") || "").trim().toLowerCase();
    const all = url.searchParams.get("all") === "1";
    if (!word && !all) return jsonError(400, "Provide ?word= or ?all=1");

    let query = supabaseAdmin.from(TABLE).delete().eq("user_code", code);
    if (word) query = query.eq("word", word);

    const { error } = await query;
    if (error) return jsonError(400, error.message || "Delete vocab failed");

    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
