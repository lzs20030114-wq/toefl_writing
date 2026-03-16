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
  "subject": "string",
  "scenario": "string",
  "direction": "string",
  "goals": ["string", "string"]
}
Rules:
- Extract every distinct email question block you find.
- "goals" must be a non-empty array of strings.
- Return [] if nothing can be parsed.`,

  build: `You are a JSON extractor. Parse TOEFL "Build a Sentence" questions from the user's text.

INPUT FORMAT (TPO style — each question has 3 parts):
  Part 1 – Person A's spoken question  →  becomes "prompt"
  Part 2 – Person B's incomplete response with _____ blanks  →  assemble into "answer"
  Part 3 – word/phrase tiles separated by " / "  →  one tile is the distractor, rest become "chunks"

Return ONLY a valid JSON array. Each element:
{
  "prompt": "Person A's spoken question",
  "answer": "Person B's complete, grammatically correct response",
  "chunks": ["tile1", "tile2", ...],
  "prefilled": ["tile"],
  "distractor": "single wrong tile or null",
  "grammar_points": ["tag"]
}

CHUNK RULES:
- Every word in "answer" must appear in either "chunks" or "prefilled".
- "prefilled" = tiles already placed in Person B's line (not scrambled). Must NOT appear in "chunks".
- Chunks are all lowercase except: I, I'm, I've, I'll, I'd.
- Multi-word phrases that belong together stay as one chunk (e.g. "to know", "had changed").

DISTRACTOR RULES — CRITICAL:
Pick the distractor that tests the SPECIFIC grammar weakness of that sentence.
Use this table:

  grammar_point contains "passive voice"
      → distractor: "gets", "have", "been", "will", or "does"
      → NEVER use "did" for passive voice sentences

  grammar_point contains "embedded question" (wanted/needed/asked + wh-word or if/whether)
      → "did" is the PRIMARY distractor (tests no-inversion rule); use it freely
      → if "did" already appears in ≥50% of the batch, alternate with "does", "do", "is", "are"

  grammar_point contains "past perfect" (had + past participle)
      → distractor: "was", "is", "have"

  grammar_point contains "negation" or "modal"
      → distractor: "can", "does", "did" (vary; avoid repeating)

  other / general
      → pick a plausible but grammatically wrong word specific to this sentence

DIVERSITY RULE: Across the entire batch, no single distractor word may appear more than 2 times.
Set distractor to null only if no plausible wrong tile exists.

Return [] if nothing can be parsed.`,
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

  // Post-process build questions: compute prefilled_positions and has_question_mark
  // so the AI never has to count word indices (error-prone).
  if (type === "build") {
    questions = questions.map((q) => postProcessBuild(q));
  }

  return Response.json({ questions });
}

// ── Build post-processor ──────────────────────────────────────────────────────
// Compute prefilled_positions from answer text (server-side, no AI needed).
// prefilled_positions[chunk] = 0-based index of chunk's first word in the answer.
function postProcessBuild(q) {
  const answer = String(q.answer || "").trim();
  const prefilled = Array.isArray(q.prefilled) ? q.prefilled : [];

  // Tokenise answer (strip punctuation for matching, preserve original words for indexing)
  const answerWords = answer
    .replace(/[.,!?;:]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());

  const prefilled_positions = {};
  for (const pf of prefilled) {
    const pfWords = String(pf)
      .replace(/[.,!?;:]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.toLowerCase());
    if (pfWords.length === 0) continue;

    for (let i = 0; i <= answerWords.length - pfWords.length; i++) {
      if (pfWords.every((w, j) => w === answerWords[i + j])) {
        prefilled_positions[pf] = i;
        break;
      }
    }
  }

  return {
    ...q,
    prefilled: prefilled,
    prefilled_positions,
    distractor: q.distractor || null,
    has_question_mark: answer.endsWith("?"),
    grammar_points: Array.isArray(q.grammar_points) ? q.grammar_points : [],
  };
}
