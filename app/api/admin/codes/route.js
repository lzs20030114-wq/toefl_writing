import { isAdminAuthorized } from "../../../../lib/adminAuth";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { jsonError } from "../../../../lib/apiResponse";

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Mock task-id → subject/subtype routing. Extend here when reading/listening tasks
// land in mock-exam (e.g. "reading-ctw": { subject: "reading", subtype: "ctw" }).
const TASKID_TO_SUBJECT_SUBTYPE = {
  "build-sentence": { subject: "writing", subtype: "build" },
  "email-writing": { subject: "writing", subtype: "email" },
  "academic-writing": { subject: "writing", subtype: "discussion" },
};

function emptyAnswered() {
  return {
    writing: { build: 0, email: 0, discussion: 0, total: 0 },
    reading: { ctw: 0, rdl: 0, ap: 0, total: 0 },
    listening: { lcr: 0, la: 0, lc: 0, lat: 0, total: 0 },
    speaking: { interview: 0, repeat: 0, total: 0 },
    // Legacy flat aliases (mirror writing.*) — kept for admin-codes UI
    build: 0,
    email: 0,
    discussion: 0,
    total: 0,
  };
}

function applyDelta(target, subject, subtype, n = 1) {
  if (!target[subject]) return;
  if (subtype && target[subject][subtype] !== undefined) {
    target[subject][subtype] += n;
  }
  target[subject].total += n;
  if (subject === "writing") {
    if (subtype && target[subtype] !== undefined) target[subtype] += n;
    target.total += n;
  }
}

function extractMockPromptIds(score) {
  const tasks = Array.isArray(score?.tasks) ? score.tasks : [];
  const ids = { email: [], discussion: [] };
  for (const t of tasks) {
    const taskId = String(t?.taskId || "");
    const pid = t?.meta?.deferredPayload?.promptId || t?.meta?.response?.promptId
      || t?.meta?.deferredPayload?.promptData?.id || t?.meta?.response?.promptData?.id || "";
    if (!pid) continue;
    if (taskId === "email-writing") ids.email.push(pid);
    else if (taskId === "academic-writing") ids.discussion.push(pid);
  }
  return ids;
}

function accumulateRow(row, target) {
  const type = String(row?.type || "");
  if (type === "bs") return applyDelta(target, "writing", "build");
  if (type === "email") return applyDelta(target, "writing", "email");
  if (type === "discussion") return applyDelta(target, "writing", "discussion");
  if (type === "reading") {
    return applyDelta(target, "reading", String(row?.subtype || "").toLowerCase());
  }
  if (type === "listening") {
    return applyDelta(target, "listening", String(row?.subtype || "").toLowerCase());
  }
  if (type === "speaking") {
    return applyDelta(target, "speaking", String(row?.subtype || "").toLowerCase());
  }
  if (type === "mock") {
    const tasks = Array.isArray(row?.score?.tasks) ? row.score.tasks : [];
    for (const t of tasks) {
      const map = TASKID_TO_SUBJECT_SUBTYPE[String(t?.taskId || "")];
      if (map) applyDelta(target, map.subject, map.subtype);
    }
  }
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
    const includeUsage = String(url.searchParams.get("includeUsage") || "").trim() === "1";

    let query = supabaseAdmin
      .from("access_codes")
      .select("code,status,issued_to,issued_at,expires_at,created_at,note,pro_days")
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

    const codes = data || [];
    if (!includeUsage) {
      return Response.json({ codes, stats });
    }

    const codeList = codes.map((x) => x.code).filter(Boolean);
    const usageByCode = {};
    codeList.forEach((code) => {
      usageByCode[code] = {
        sessions: 0,
        answered: emptyAnswered(),
        lastActiveAt: null,
        tier: null,
        tierExpiresAt: null,
      };
    });

    // Fetch user tier info
    if (codeList.length > 0) {
      const { data: userRows } = await supabaseAdmin
        .from("users")
        .select("code,tier,tier_expires_at,status")
        .in("code", codeList);
      for (const row of userRows || []) {
        const code = String(row.code || "");
        if (code && usageByCode[code]) {
          usageByCode[code].tier = row.tier || null;
          usageByCode[code].tierExpiresAt = row.tier_expires_at || null;
          usageByCode[code].userStatus = row.status || null;
        }
      }
    }

    if (codeList.length > 0) {
      const [{ data: sessionRows, error: sessionError }, { data: promptRows }] = await Promise.all([
        supabaseAdmin
          .from("sessions")
          .select("user_code,type,date,score,subtype:details->>subtype")
          .in("user_code", codeList)
          .order("date", { ascending: false })
          .limit(20000),
        supabaseAdmin
          .from("sessions")
          .select("user_code,type,pid:details->>promptId")
          .in("user_code", codeList)
          .in("type", ["email", "discussion"])
          .limit(10000),
      ]);
      if (sessionError) return jsonError(400, sessionError.message || "Usage query failed");

      const uniqueSets = {};
      codeList.forEach((c) => { uniqueSets[c] = { email: new Set(), discussion: new Set() }; });

      for (const row of sessionRows || []) {
        const code = String(row.user_code || "");
        if (!code || !usageByCode[code]) continue;
        const usage = usageByCode[code];
        usage.sessions += 1;
        if (!usage.lastActiveAt || String(row.date || "") > String(usage.lastActiveAt || "")) {
          usage.lastActiveAt = row.date || null;
        }
        accumulateRow(row, usage.answered);
        if (String(row?.type || "") === "mock" && uniqueSets[code]) {
          const ids = extractMockPromptIds(row.score);
          ids.email.forEach((pid) => uniqueSets[code].email.add(pid));
          ids.discussion.forEach((pid) => uniqueSets[code].discussion.add(pid));
        }
      }

      for (const row of promptRows || []) {
        const code = String(row.user_code || "");
        const pid = row.pid;
        if (!code || !uniqueSets[code] || !pid) continue;
        uniqueSets[code][row.type === "email" ? "email" : "discussion"].add(pid);
      }

      codeList.forEach((code) => {
        if (usageByCode[code]) {
          usageByCode[code].uniqueEmail = uniqueSets[code]?.email?.size || 0;
          usageByCode[code].uniqueDiscussion = uniqueSets[code]?.discussion?.size || 0;
        }
      });
    }

    return Response.json({ codes, stats, usageByCode });
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

    if (action === "restore") {
      const code = String(body?.code || "").toUpperCase().trim();
      if (!code || code.length !== CODE_LEN) return jsonError(400, "Invalid code");
      const { data, error } = await supabaseAdmin
        .from("access_codes")
        .update({ status: "available" })
        .eq("code", code)
        .eq("status", "revoked")
        .select("code,status")
        .single();
      if (error) return jsonError(400, error.message || "Restore failed");
      return Response.json({ ok: true, restored: data });
    }

    if (action === "delete") {
      const code = String(body?.code || "").toUpperCase().trim();
      if (!code || code.length !== CODE_LEN) return jsonError(400, "Invalid code");
      const { error } = await supabaseAdmin
        .from("access_codes")
        .delete()
        .eq("code", code)
        .eq("status", "revoked");
      if (error) return jsonError(400, error.message || "Delete failed");
      return Response.json({ ok: true, deleted: code });
    }

    if (action === "update-note") {
      const code = String(body?.code || "").toUpperCase().trim();
      if (!code) return jsonError(400, "Missing code");
      const note = body?.note != null ? String(body.note).slice(0, 500) : "";
      const { data, error } = await supabaseAdmin
        .from("access_codes")
        .update({ note })
        .eq("code", code)
        .select("code,note")
        .single();
      if (error) return jsonError(400, error.message || "Update note failed");
      return Response.json({ ok: true, updated: data });
    }

    return jsonError(400, "Unsupported action");
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
