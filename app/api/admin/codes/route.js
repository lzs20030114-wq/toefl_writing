import { isAdminAuthorized } from "../../../../lib/adminAuth";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;

function jsonError(status, error) {
  return Response.json({ error }, { status });
}

function randomCode() {
  let code = "";
  for (let i = 0; i < CODE_LEN; i += 1) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

async function generateCodes(count) {
  const codes = [];
  const seen = new Set();
  const maxAttempts = count * 40;
  let attempts = 0;

  while (codes.length < count && attempts < maxAttempts) {
    attempts += 1;
    const code = randomCode();
    if (seen.has(code)) continue;
    seen.add(code);
    const { error } = await supabaseAdmin.from("access_codes").insert({ code, status: "available" });
    if (!error) codes.push(code);
  }

  if (codes.length < count) {
    throw new Error(`Only generated ${codes.length}/${count} codes`);
  }
  return codes;
}

async function issueCode({ code, issuedTo, expiresAt }) {
  const now = new Date().toISOString();
  if (code) {
    const normalized = String(code).toUpperCase().trim();
    const patch = {
      status: "issued",
      issued_to: issuedTo || null,
      issued_at: now,
      expires_at: expiresAt || null,
    };
    const { data, error } = await supabaseAdmin
      .from("access_codes")
      .update(patch)
      .eq("code", normalized)
      .eq("status", "available")
      .select("code,status,issued_to,issued_at,expires_at")
      .single();
    if (error) throw new Error(error.message || "Issue code failed");
    return data;
  }

  const { data: available, error: pickError } = await supabaseAdmin
    .from("access_codes")
    .select("code")
    .eq("status", "available")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();
  if (pickError || !available?.code) throw new Error("No available codes");

  return issueCode({ code: available.code, issuedTo, expiresAt });
}

export async function GET(request) {
  try {
    if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const url = new URL(request.url);
    const status = String(url.searchParams.get("status") || "").trim();
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 100)));

    let query = supabaseAdmin
      .from("access_codes")
      .select("code,status,issued_to,issued_at,expires_at,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status) query = query.eq("status", status);

    const [{ data, error }, { data: statsRows, error: statsError }] = await Promise.all([
      query,
      supabaseAdmin.from("access_codes").select("status"),
    ]);

    if (error) return jsonError(400, error.message || "List codes failed");
    if (statsError) return jsonError(400, statsError.message || "Stats query failed");

    const stats = { available: 0, issued: 0, revoked: 0, total: 0 };
    (statsRows || []).forEach((r) => {
      stats.total += 1;
      const s = String(r.status || "");
      if (s === "available" || s === "issued" || s === "revoked") stats[s] += 1;
    });

    return Response.json({ codes: data || [], stats });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}

export async function POST(request) {
  try {
    if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const body = await request.json();
    const action = String(body?.action || "").trim();

    if (action === "generate") {
      const count = Math.min(500, Math.max(1, Number(body?.count || 10)));
      const codes = await generateCodes(count);
      return Response.json({ ok: true, generated: codes.length, codes });
    }

    if (action === "issue") {
      const issued = await issueCode({
        code: body?.code ? String(body.code).trim() : "",
        issuedTo: body?.issuedTo ? String(body.issuedTo).trim() : "",
        expiresAt: body?.expiresAt ? String(body.expiresAt).trim() : "",
      });
      return Response.json({ ok: true, issued });
    }

    if (action === "revoke") {
      const code = String(body?.code || "").toUpperCase().trim();
      if (!code || code.length !== CODE_LEN) return jsonError(400, "Invalid code");
      const { data, error } = await supabaseAdmin
        .from("access_codes")
        .update({ status: "revoked" })
        .eq("code", code)
        .select("code,status")
        .single();
      if (error) return jsonError(400, error.message || "Revoke failed");
      return Response.json({ ok: true, revoked: data });
    }

    return jsonError(400, "Unsupported action");
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}

