import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../lib/rateLimit";
import { jsonError } from "../../../lib/apiResponse";
import { mergeCards } from "../../../lib/vocab/book";

/**
 * 单词本的云端副本。
 *
 * 本地 localStorage 才是真源（见 lib/vocab/vocabStore.js），这里只是跨设备的
 * 一份镜像：整张卡片以 JSONB 存，因为 SRS 字段以后还会变（换权重、加卡片方向），
 * 每加一个字段就跑一次迁移不值当。word 和 updated_at 提成列，供去重与增量合并。
 */

const TABLE = "vocab_cards";
const MAX_CARDS_PER_REQUEST = 100;
const CARD_MAX_BYTES = 8 * 1024;
const WORD_MAX_LEN = 60;
const PAGE_SIZE = 500;
const LEGACY_MAX_CARDS = 10_000;
const LEGACY_MAX_BYTES = 8 * 1024 * 1024;
const CAS_ATTEMPTS = 6;
const WRITE_CONCURRENCY = 8;

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
    bytes = Buffer.byteLength(JSON.stringify(raw), "utf8");
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

function rowCard(row) {
  return { ...(row.card || {}), word: row.word, updatedAt: row.updated_at };
}

function isConflict(error) {
  return error?.code === "23505";
}

async function loadCard(code, word) {
  return supabaseAdmin.from(TABLE).select("word,card,updated_at,version")
    .eq("user_code", code).eq("word", word).maybeSingle();
}

// 每张卡在数据库当前版本上做业务合并。UPDATE 由触发器推进 version，旧 API
// 在部署切换期写入也会推进版本，因此并发冲突一定能被发现并重新合并。
async function saveCard(code, incoming, initial) {
  let current = initial;
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
    const merged = mergeCards(current ? [rowCard(current)] : [], [incoming.card])[0];
    const { row, error: validationError } = toRow(code, merged);
    if (validationError) return { error: validationError, status: 400 };

    if (current) {
      // 无实质变化时避免一次无意义写入；并发更新已经在初始读之后发生也无妨，
      // 因为此请求没有尚待保存的增量。
      if (JSON.stringify(merged) === JSON.stringify(mergeCards([rowCard(current)], [])[0])) {
        return { saved: true };
      }
      if (current.version == null) return { error: "Vocab CAS migration is missing", status: 503 };
      const { data, error } = await supabaseAdmin.from(TABLE)
        .update({ card: row.card, updated_at: row.updated_at })
        .eq("user_code", code).eq("word", row.word).eq("version", current.version)
        .select("version");
      if (error) return { error: error.message || "Save vocab failed", status: 503 };
      if (data?.length) return { saved: true };
    } else {
      const { error } = await supabaseAdmin.from(TABLE).insert(row);
      if (!error) return { saved: true };
      if (!isConflict(error)) return { error: error.message || "Save vocab failed", status: 503 };
    }

    const read = await loadCard(code, row.word);
    if (read.error) return { error: read.error.message || "Reload vocab failed", status: 503 };
    current = read.data;
  }
  return { error: "Vocab card changed concurrently; retry sync", status: 503 };
}

async function saveCards(code, rows, initialRows) {
  const known = new Map((initialRows || []).map((r) => [r.word, r]));
  // Bounded parallelism keeps large batches responsive without flooding PostgREST.
  let next = 0;
  const results = new Array(rows.length);
  const workers = Array.from({ length: Math.min(WRITE_CONCURRENCY, rows.length) }, async () => {
    while (next < rows.length) {
      const index = next++;
      results[index] = await saveCard(code, rows[index], known.get(rows[index].word) || null);
    }
  });
  await Promise.all(workers);
  return results.find((result) => result?.error) || null;
}

async function readPage(code, cursor, size) {
  let query = supabaseAdmin.from(TABLE).select("word,card,updated_at")
    .eq("user_code", code).order("word", { ascending: true }).limit(size + 1);
  if (cursor) query = query.gt("word", cursor);
  const { data, error } = await query;
  if (error) return { error };
  const page = (data || []).slice(0, size);
  return {
    cards: page.map(rowCard),
    nextCursor: (data || []).length > size ? page[page.length - 1].word : null,
  };
}

export async function GET(request) {
  try {
    if (limiter.isLimited(getIp(request))) return jsonError(429, "Too many requests");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const url = new URL(request.url);
    const code = normalizeCode(url.searchParams.get("code"));
    if (!code) return jsonError(400, "code is required");

    const explicitPage = url.searchParams.has("limit") || url.searchParams.has("cursor");
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit == null ? PAGE_SIZE : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_SIZE) {
      return jsonError(400, `limit must be an integer between 1 and ${PAGE_SIZE}`);
    }
    const cursor = url.searchParams.get("cursor") || "";
    if (cursor.length > WORD_MAX_LEN) return jsonError(400, "invalid cursor");

    if (explicitPage) {
      const page = await readPage(code, cursor, limit);
      if (page.error) return jsonError(503, page.error.message || "Load vocab failed");
      return Response.json({ ok: true, cards: page.cards, nextCursor: page.nextCursor });
    }

    // 旧客户端只发一次 GET：服务端内部拉全量，避免静默截断在原先的 3000 张。
    // 极端大账户返回显式错误；新版客户端会走无限 keyset 分页。
    const cards = [];
    let nextCursor = "";
    let bytes = 0;
    do {
      const page = await readPage(code, nextCursor, PAGE_SIZE);
      if (page.error) return jsonError(503, page.error.message || "Load vocab failed");
      cards.push(...page.cards);
      bytes += Buffer.byteLength(JSON.stringify(page.cards), "utf8");
      if (cards.length > LEGACY_MAX_CARDS || bytes > LEGACY_MAX_BYTES) {
        return jsonError(413, "Vocab collection too large for single-page sync; update client");
      }
      nextCursor = page.nextCursor;
    } while (nextCursor);
    return Response.json({ ok: true, cards, nextCursor: null });
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
    const rowIndex = new Map();
    for (const raw of cards) {
      const { row, error } = toRow(code, raw);
      if (error) return jsonError(400, error);
      // 同批同词也要按两套进度合并，不能简单留最后一张。
      if (rowIndex.has(row.word)) {
        const index = rowIndex.get(row.word);
        const merged = mergeCards([rows[index].card], [row.card])[0];
        const combined = toRow(code, merged);
        if (combined.error) return jsonError(400, combined.error);
        rows[index] = combined.row;
      } else {
        rowIndex.set(row.word, rows.length);
        rows.push(row);
      }
    }

    const { data: initialRows, error: readError } = await supabaseAdmin.from(TABLE)
      .select("word,card,updated_at,version").eq("user_code", code)
      .in("word", rows.map((r) => r.word));
    if (readError) return jsonError(503, readError.message || "Load vocab failed");
    const failure = await saveCards(code, rows, initialRows);
    if (failure) return jsonError(failure.status, failure.error);

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
