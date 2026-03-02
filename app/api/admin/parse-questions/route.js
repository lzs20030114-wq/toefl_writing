import { isAdminAuthorized } from "../../../../lib/adminAuth";
const { callDeepSeekViaCurl, resolveProxyUrl } = require("../../../../lib/ai/deepseekHttp");

// Strip markdown code fences that DeepSeek sometimes wraps around JSON
function extractJson(raw) {
  const s = raw.trim();
  // ```json ... ``` or ``` ... ```
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) return fenced[1].trim();
  return s;
}

const SYSTEM_PROMPTS = {
  academic: `You are a JSON extractor. Parse the user's text into TOEFL academic writing discussion questions.
Return ONLY a valid JSON array (no markdown, no explanation) where each element has this exact shape:
{
  "professor": { "name": "string", "text": "string" },
  "students": [
    { "name": "string", "text": "string" },
    { "name": "string", "text": "string" }
  ]
}
Rules:
- Extract every distinct question block you find.
- If a professor name is missing use "Professor".
- If student names are missing use "Student A" / "Student B".
- Return [] if nothing can be parsed.`,

  email: `You are a JSON extractor. Parse the user's text into TOEFL email writing questions.
Return ONLY a valid JSON array (no markdown, no explanation) where each element has this exact shape:
{
  "to": "string",
  "from": "string",
  "scenario": "string",
  "direction": "string",
  "goals": ["string", "string"]
}
Rules:
- Extract every distinct email question block you find.
- "goals" must be a non-empty array of strings.
- Return [] if nothing can be parsed.`,

  build: `You are a JSON extractor. Parse the user's text into TOEFL build-sentence questions.
Return ONLY a valid JSON array (no markdown, no explanation) where each element has this exact shape:
{
  "prompt": "string",
  "answer": "string",
  "chunks": ["string"],
  "prefilled": ["string"],
  "distractor": "string",
  "grammar_points": ["string"]
}
Rules:
- Extract every distinct sentence-building question you find.
- "chunks" must be a non-empty array of word/phrase strings.
- "prefilled", "distractor", "grammar_points" are optional — omit or set to [] / "" if not present.
- Return [] if nothing can be parsed.`,
};

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

  return Response.json({ questions });
}
