import { isAdminAuthorized } from "../../../../lib/adminAuth";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { readFileSync } from "fs";
import { join } from "path";

function readJson(relPath) {
  try {
    const abs = join(process.cwd(), relPath);
    const text = readFileSync(abs, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function GET(request) {
  if (!isAdminAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const academic = readJson("data/academicWriting/prompts.json") ?? [];
  const email = readJson("data/emailWriting/prompts.json") ?? [];
  const buildSentence = readJson("data/buildSentence/questions.json") ?? { question_sets: [] };

  // Merge Supabase admin_questions if configured
  if (supabaseAdmin) {
    const { data: rows } = await supabaseAdmin
      .from("admin_questions")
      .select("*")
      .order("created_at", { ascending: true });

    if (rows) {
      for (const row of rows) {
        if (row.type === "academic") {
          academic.push(row.data);
        } else if (row.type === "email") {
          email.push(row.data);
        } else if (row.type === "build") {
          const setId = row.data.set_id ?? "custom";
          let set = buildSentence.question_sets.find((s) => s.set_id === setId);
          if (!set) {
            set = { set_id: setId, questions: [] };
            buildSentence.question_sets.push(set);
          }
          set.questions.push(row.data);
        }
      }
    }
  }

  return Response.json({ academic, email, buildSentence });
}

export async function POST(request) {
  if (!isAdminAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!supabaseAdmin) {
    return Response.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  if (!body || !body.type || !body.data) {
    return Response.json({ error: "Missing type or data" }, { status: 400 });
  }

  const { type, data } = body;

  // Auto-generate question_id
  let question_id;
  if (type === "academic") {
    const jsonData = readJson("data/academicWriting/prompts.json") ?? [];
    const { count } = await supabaseAdmin
      .from("admin_questions")
      .select("id", { count: "exact", head: true })
      .eq("type", "academic");
    const total = jsonData.length + (count ?? 0);
    question_id = `ad${total + 1}`;
  } else if (type === "email") {
    const jsonData = readJson("data/emailWriting/prompts.json") ?? [];
    const { count } = await supabaseAdmin
      .from("admin_questions")
      .select("id", { count: "exact", head: true })
      .eq("type", "email");
    const total = jsonData.length + (count ?? 0);
    question_id = `em${total + 1}`;
  } else if (type === "build") {
    question_id = `bs_custom_${Date.now()}`;
  } else {
    return Response.json({ error: "Invalid type" }, { status: 400 });
  }

  const dataWithId = { ...data, id: question_id };

  const { error } = await supabaseAdmin
    .from("admin_questions")
    .insert({ type, question_id, data: dataWithId });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true, question_id });
}
