// 个人题库 CRUD。GET 列出当前用户的题；POST 校验后存入（服务端 mint id + Pro/额度门禁）；
// DELETE 按 id/itemId 删除（均 .eq('user_code') 作用域，permissive RLS 下这是唯一 IDOR 防线）。
// 镜像 app/api/mistakes/favorites/route.js 的写法 + /api/ai 的 origin 与 Pro 门禁。
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../lib/rateLimit";
import { jsonError } from "../../../lib/apiResponse";
import { gateUserBankRequest } from "../../../lib/userBankAuth";

// Storage whitelist follows shipped types. Widen alongside each launch (discussion+email
// P0; repeat+interview, then build, then rdl+ap). The DB CHECK covers all 12 subtypes already.
const VALID_TYPES = new Set(["discussion", "email", "repeat", "interview", "build", "rdl", "ap"]);
const VALID_STATUS = new Set(["ready", "draft"]);
const ITEM_MAX_BYTES = 16 * 1024;
const MAX_ITEMS_PER_REQUEST = 50;
const LIST_MAX = 500;
const SELECT_COLS = "id,item_id,type,data,status,source,created_at";

const limiter = createRateLimiter("user-bank", { window: 60_000, max: 60 });

function normalizeCode(raw) {
  return String(raw || "").toUpperCase().trim();
}
function isValidCode(code) {
  return code.length === 6;
}

// Origin guard copied verbatim from /api/ai (app/api/ai/route.js:34-63).
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

function validateItem(item, fallbackType) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return "item must be an object";
  const data = item.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return "item.data must be an object";
  const type = String(item.type || fallbackType || "").toLowerCase();
  if (!VALID_TYPES.has(type)) return `invalid type "${type}"`;
  if (item.status != null && !VALID_STATUS.has(String(item.status))) return `invalid status "${item.status}"`;
  let bytes;
  try {
    bytes = JSON.stringify(data).length;
  } catch {
    return "item.data is not JSON-serializable";
  }
  if (bytes > ITEM_MAX_BYTES) return `item too large (${bytes} > ${ITEM_MAX_BYTES} bytes)`;
  return null;
}

export async function GET(request) {
  try {
    if (limiter.isLimited(getIp(request))) return jsonError(429, "Too many requests");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const url = new URL(request.url);
    const code = normalizeCode(url.searchParams.get("code"));
    if (!isValidCode(code)) return jsonError(400, "code is required");

    const typeFilter = url.searchParams.get("type");
    if (typeFilter && !VALID_TYPES.has(typeFilter)) return jsonError(400, `Invalid type "${typeFilter}"`);

    let query = supabaseAdmin.from("user_question_banks").select(SELECT_COLS).eq("user_code", code);
    if (typeFilter) query = query.eq("type", typeFilter);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(LIST_MAX);
    if (error) return jsonError(400, error.message || "Load failed");

    return Response.json({ ok: true, items: data || [] });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}

export async function POST(request) {
  try {
    if (limiter.isLimited(getIp(request))) return jsonError(429, "Too many requests");
    if (!isOriginAllowed(request)) return jsonError(403, "Forbidden origin.");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const body = await request.json().catch(() => ({}));
    const code = normalizeCode(body?.code);
    if (!isValidCode(code)) return jsonError(400, "code is required");

    const gate = await gateUserBankRequest({ userCode: code });
    if (!gate.ok) return Response.json({ error: gate.error, code: gate.code }, { status: gate.status });

    const items = Array.isArray(body?.items) ? body.items : null;
    if (!items || items.length === 0) return jsonError(400, "items must be a non-empty array");
    if (items.length > MAX_ITEMS_PER_REQUEST) return jsonError(400, `Too many items (max ${MAX_ITEMS_PER_REQUEST})`);

    const fallbackType = body?.type;
    for (let i = 0; i < items.length; i++) {
      const err = validateItem(items[i], fallbackType);
      if (err) return jsonError(400, `items[${i}]: ${err}`);
    }

    // One Date.now() per request; index disambiguates the batch. 'usr_' reserved prefix.
    const ts = Date.now();
    const rows = items.map((item, i) => ({
      user_code: code,
      type: String(item.type || fallbackType).toLowerCase(),
      data: item.data,
      status: item.status && VALID_STATUS.has(String(item.status)) ? String(item.status) : "ready",
      source: body?.source || item.source || null,
      item_id: `usr_${code}_${ts}_${i}`,
    }));

    const { data: inserted, error } = await supabaseAdmin
      .from("user_question_banks")
      .insert(rows)
      .select(SELECT_COLS);
    if (error) {
      // 23505 = unique_violation on (user_code,item_id) — treat as idempotent re-POST.
      if (error.code === "23505") {
        const ids = rows.map((r) => r.item_id);
        const { data: existing } = await supabaseAdmin
          .from("user_question_banks")
          .select(SELECT_COLS)
          .eq("user_code", code)
          .in("item_id", ids);
        return Response.json({ ok: true, items: existing || [], deduped: true });
      }
      return jsonError(400, error.message || "Save failed");
    }

    return Response.json({ ok: true, items: inserted || [] });
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
    if (!isValidCode(code)) return jsonError(400, "code is required");

    const idRaw = url.searchParams.get("id");
    const itemId = url.searchParams.get("itemId");

    let query = supabaseAdmin.from("user_question_banks").delete().eq("user_code", code);
    if (idRaw) {
      const id = Number(idRaw);
      if (!Number.isInteger(id) || id <= 0) return jsonError(400, "id must be a positive integer");
      query = query.eq("id", id);
    } else if (itemId) {
      query = query.eq("item_id", String(itemId));
    } else {
      return jsonError(400, "Provide either ?id= or ?itemId=");
    }

    const { data, error } = await query.select("id");
    if (error) return jsonError(400, error.message || "Delete failed");

    return Response.json({ ok: true, removed: (data || []).length });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
