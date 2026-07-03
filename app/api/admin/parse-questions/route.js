import { isAdminAuthorized } from "../../../../lib/adminAuth";
const { callDeepSeekViaCurl, resolveProxyUrl } = require("../../../../lib/ai/deepseekHttp");
// SYSTEM_PROMPTS / extractJson / postProcessBuild moved to a shared module so the
// user-facing /api/user-bank/extract route runs the EXACT same extraction. Do not
// re-inline — keep this the single source of the extraction prompts.
const { SYSTEM_PROMPTS, extractJson, postProcessBuild } = require("../../../../lib/ai/prompts/questionExtraction");

async function callDeepSeek(systemPrompt, userText) {
  const payload = {
    model: "deepseek-chat",
    temperature: 0.1,
    max_tokens: 4096,
    stream: false,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText },
    ],
  };

  const proxyUrl = resolveProxyUrl();
  if (proxyUrl) {
    return callDeepSeekViaCurl({
      apiKey: process.env.DEEPSEEK_API_KEY,
      proxyUrl,
      timeoutMs: 60000,
      payload,
    });
  }

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + process.env.DEEPSEEK_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek API error: ${res.status} — ${errText.slice(0, 200)}`);
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek returned empty content");
  return content;
}

export async function POST(request) {
  if (!isAdminAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.DEEPSEEK_API_KEY) {
    return Response.json({ error: "DEEPSEEK_API_KEY not configured" }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.type || !body?.text?.trim()) {
    return Response.json({ error: "Missing type or text" }, { status: 400 });
  }

  const { type, text } = body;
  const systemPrompt = SYSTEM_PROMPTS[type];
  if (!systemPrompt) {
    return Response.json({ error: "Invalid type" }, { status: 400 });
  }

  let rawContent;
  try {
    rawContent = await callDeepSeek(systemPrompt, text.trim());
  } catch (e) {
    return Response.json({ error: e.message }, { status: 502 });
  }

  let questions;
  try {
    questions = JSON.parse(extractJson(rawContent));
    if (!Array.isArray(questions)) throw new Error("not an array");
  } catch {
    return Response.json(
      { error: "AI returned invalid JSON. Try rephrasing the input.", raw: rawContent.slice(0, 500) },
      { status: 422 }
    );
  }

  // Post-process build questions: compute prefilled_positions and has_question_mark
  // so the AI never has to count word indices (error-prone).
  if (type === "build") {
    questions = questions.map((q) => postProcessBuild(q));
  }

  return Response.json({ questions });
}
