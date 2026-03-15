import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../lib/supabaseAdmin";

const FB_RL_WINDOW = 60_000;
const FB_RL_MAX = 10;
const fbBuckets = globalThis.__toeflFeedbackRLBuckets || new Map();
if (!globalThis.__toeflFeedbackRLBuckets) globalThis.__toeflFeedbackRLBuckets = fbBuckets;

function getIp(req) {
  return req.headers.get("cf-connecting-ip")
    || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    || req.headers.get("x-real-ip")
    || "unknown";
}

function isFbRateLimited(ip) {
  const now = Date.now();
  for (const [k, v] of fbBuckets) { if (now - v.t > FB_RL_WINDOW) fbBuckets.delete(k); }
  const b = fbBuckets.get(ip);
  if (!b || now - b.t > FB_RL_WINDOW) { fbBuckets.set(ip, { t: now, c: 1 }); return false; }
  b.c++;
  return b.c > FB_RL_MAX;
}

export async function GET(request) {
  try {
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");
    const url = new URL(request.url);
    const userCode = String(url.searchParams.get("userCode") || "").trim().toUpperCase();
    if (!userCode) return jsonError(400, "Missing userCode");
    const { data, error } = await supabaseAdmin
      .from("user_feedback")
      .select("id,content,status,admin_reply,created_at")
      .eq("user_code", userCode)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) return jsonError(400, error.message);
    return Response.json({ rows: data || [] });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected error");
  }
}

function jsonError(status, error) {
  return Response.json({ error }, { status });
}

function parseIp(request) {
  const forwarded = String(request.headers.get("x-forwarded-for") || "").trim();
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = String(request.headers.get("x-real-ip") || "").trim();
  return realIp || null;
}

export async function POST(request) {
  if (isFbRateLimited(getIp(request))) {
    return jsonError(429, "Too many requests");
  }
  try {
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const body = await request.json().catch(() => ({}));
    const userCode = String(body?.userCode || "").trim().toUpperCase();
    const content = String(body?.content || "").trim();
    const page = String(body?.page || "").trim().slice(0, 120) || "/";

    if (!userCode) return jsonError(400, "Missing userCode");
    if (!content) return jsonError(400, "Feedback content is required");
    if (content.length > 2000) return jsonError(400, "Feedback content is too long");

    const record = {
      user_code: userCode,
      content,
      page,
      origin: String(request.headers.get("origin") || "").slice(0, 200) || null,
      user_agent: String(request.headers.get("user-agent") || "").slice(0, 400) || null,
      client_ip: parseIp(request),
    };

    const { error } = await supabaseAdmin.from("user_feedback").insert(record);
    if (error) return jsonError(400, error.message || "Insert feedback failed");

    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
