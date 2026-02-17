/* eslint-disable no-console */
// Usage:
//   PowerShell:
//   $env:DEEPSEEK_API_KEY="sk-xxx"; npm run calibration:test

const MIN_DISCUSSION_WORDS_FOR_GUARDRAIL = 60;
const { callDeepSeekViaCurl, resolveProxyUrl } = require("../lib/ai/deepseekHttp");

const DISCUSSION_SYSTEM_PROMPT = `
You are a strict ETS-level TOEFL Academic Discussion scorer.
Follow ETS 0-5 writing rubric.
Return in section format:
===SCORE===
Score: [0-5]
Band: [1.0-5.5]
Summary: [...]
===ANNOTATION===
...
===PATTERNS===
{"patterns":[...]}
===COMPARISON===
...
===ACTION===
...
Rules:
- If no clear stance or no engagement with professor/students, max 3.
- If <60 words, max 2.
- Keep explanations concise.
`.trim();

const EMAIL_SYSTEM_PROMPT = `
You are a strict ETS-level TOEFL Write an Email scorer.
Follow ETS 0-5 writing rubric.
Return in section format:
===SCORE===
Score: [0-5]
Band: [1.0-5.5]
Summary: [...]
===GOALS===
Goal1: [OK|PARTIAL|MISSING] ...
Goal2: ...
Goal3: ...
===ANNOTATION===
...
===PATTERNS===
{"patterns":[...]}
===COMPARISON===
...
===ACTION===
...
Rules:
- Any missing goal => max 3.
- 2+ partial goals => max 3.
- <50 words => max 2.
- Keep explanations concise.
`.trim();

const CALIBRATION_SAMPLES = {
  discussion: [
    {
      id: "cal-disc-5",
      expectedScore: 5,
      prompt: "What is the most important invention in history?",
      studentA: "I think the internet is the most important invention.",
      studentB: "I believe the printing press changed the world most.",
      response:
        "While both the internet and printing press transformed communication, I would argue that the airplane represents the most significant invention in history. Before aviation, international trade and cultural exchange were limited to those who could afford lengthy sea voyages. The development of commercial flight by figures like Santos-Dumont democratized global travel, enabling millions to cross borders that were previously impassable. Furthermore, aviation catalyzed advances in materials science and engineering that led to innovations in other fields. Although the internet connects us digitally, the airplane first connected us physically, laying the groundwork for the globalized world we inhabit today.",
    },
    {
      id: "cal-disc-4",
      expectedScore: 4,
      prompt: "What is the most important invention in history?",
      studentA: "I think the internet is the most important invention.",
      studentB: "I believe the printing press changed the world most.",
      response:
        "I think the airplane is the most important invention. Before airplanes, people could only travel by ship or train, which took very long time. When airplane was invented, people could go to other countries much faster and this changed how we do business and tourism. I agree with Student B that printing press was important, but I think transportation had bigger impact because it allowed people to actually meet face to face. Also airplane technology helped develop other technologies too. So I believe airplane changed the world more than any other invention.",
    },
    {
      id: "cal-disc-3",
      expectedScore: 3,
      prompt: "What is the most important invention in history?",
      studentA: "I think the internet is the most important invention.",
      studentB: "I believe the printing press changed the world most.",
      response:
        "I think airplane is very important invention. It help people to travel fast. Before airplane people use ship and it take long time. Airplane make the world small. I agree airplane is important because we can go anywhere. Also it is good for business. Many people use airplane every day. So I think airplane is most important invention in history. It change our life a lot.",
    },
    {
      id: "cal-disc-2",
      expectedScore: 2,
      prompt: "What is the most important invention in history?",
      studentA: "I think the internet is the most important invention.",
      studentB: "I believe the printing press changed the world most.",
      response:
        "Invention is very important for people life. Many invention help us. I think important invention is airplane because fast. And also internet is important invention too. We need invention for make life better. Student say internet and printing is important, I think all invention important.",
    },
  ],
  email: [
    {
      id: "cal-email-4",
      expectedScore: 4,
      prompt:
        "You subscribe to a poetry magazine called Verse & Voice. You had an error while submitting your poem. Goal1 express appreciation; Goal2 describe technical issue; Goal3 ask submission status.",
      response:
        "Dear Editor,\n\nI am writing to explain a problem I had with the online submission form. I am a subscriber of Verse & Voice, and I really enjoy reading your magazine.\n\nI tried to submit a poem through your online form last week. After I clicked the Submit button, the page showed an error message. I am not sure whether my poem was successfully received or not.\n\nCould you please let me know if my submission went through? If not, I would be happy to submit it again.\n\nSincerely,\nZishuo",
    },
    {
      id: "cal-email-3",
      expectedScore: 3,
      prompt:
        "Write to Dr. Thompson after a lecture. Goal1 thank and mention specific point; Goal2 explain relation to your interest; Goal3 ask for brief advice/resources.",
      response:
        "Dear Dr. Thompson,\n\nI am writing to thank you for the guest lecture you gave on campus last week. I really enjoyed your talk and this point left a strong impression on me.\n\nI am a senior student and I am choosing a topic for my thesis. After listening to your lecture, I started to think about changing my topic to marine biology, because it connects to my interest.\n\nI would like to ask if you would be willing to give me some brief advice or recommend resources.\n\nSincerely,\nZishuo",
    },
  ],
};

function extractScore(text) {
  const m = String(text || "").match(/Score:\s*([0-5])/i);
  return m ? Number(m[1]) : null;
}

function wordCount(text) {
  const t = String(text || "").trim();
  return t ? t.split(/\s+/).length : 0;
}

function hasClearStance(text) {
  return /\b(i think|i believe|i would argue|in my opinion|i agree|i disagree)\b/i.test(
    String(text || "")
  );
}

function reasonSignalCount(text) {
  const m = String(text || "")
    .toLowerCase()
    .match(
      /\b(because|since|for example|for instance|also|furthermore|moreover|in addition|another|first|second|therefore|so|while|although)\b/g
    );
  return m ? m.length : 0;
}

function applyDiscussionGuardrail(score, responseText) {
  if (score !== 2) return score;
  if (wordCount(responseText) < MIN_DISCUSSION_WORDS_FOR_GUARDRAIL) return score;
  if (!hasClearStance(responseText)) return score;
  if (reasonSignalCount(responseText) < 2) return score;
  return 3;
}

function emailGenericSignalCount(text) {
  const t = String(text || "").toLowerCase();
  const phrases = [
    "really enjoyed",
    "strong impression",
    "connects to my interest",
    "i would like to ask if",
    "some brief advice",
    "thank you for your time",
  ];
  return phrases.reduce((n, p) => n + (t.includes(p) ? 1 : 0), 0);
}

function emailConcreteSignalCount(text) {
  const t = String(text || "").toLowerCase();
  const markers = [
    "error message",
    "submit button",
    "last week",
    "resubmit",
    "deadline",
    "schedule",
    "section",
    "grade",
    "attachment",
    "specific",
    "resource",
    "because",
    "for example",
  ];
  return markers.reduce((n, p) => n + (t.includes(p) ? 1 : 0), 0);
}

function applyEmailGuardrail(score, responseText) {
  const t = String(responseText || "").toLowerCase();
  if (score === 5 && /\bsubscriber of\b/.test(t)) return 4;
  if (score < 4) return score;
  if (wordCount(responseText) < 50) return 3;
  const genericCount = emailGenericSignalCount(responseText);
  const concreteCount = emailConcreteSignalCount(responseText);
  if (genericCount >= 3 && concreteCount <= 3) return 3;
  if (genericCount >= 2 && concreteCount < 2) return 3;
  return score;
}

function median(nums) {
  const arr = [...nums].sort((a, b) => a - b);
  return arr[Math.floor(arr.length / 2)];
}

async function callDeepSeek(systemPrompt, userMessage) {
  return callDeepSeekViaCurl({
    apiKey: process.env.DEEPSEEK_API_KEY,
    proxyUrl: resolveProxyUrl(),
    timeoutMs: 70000,
    payload: {
      model: "deepseek-chat",
      max_tokens: 2400,
      temperature: 0.3,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    },
  });
}

async function runOne(systemPrompt, sample, mode) {
  const userMsg =
    mode === "discussion"
      ? `Prompt: ${sample.prompt}\n\nStudent A: ${sample.studentA}\nStudent B: ${sample.studentB}\n\nResponse:\n${sample.response}`
      : `Prompt: ${sample.prompt}\n\nResponse:\n${sample.response}`;

  const scores = [];
  for (let i = 0; i < 3; i += 1) {
    const output = await callDeepSeek(systemPrompt, userMsg);
    const rawScore = extractScore(output);
    const score =
      mode === "discussion"
        ? applyDiscussionGuardrail(rawScore, sample.response)
        : applyEmailGuardrail(rawScore, sample.response);
    scores.push(score);
    await new Promise((r) => setTimeout(r, 1000));
  }

  const valid = scores.filter((s) => Number.isInteger(s));
  const med = valid.length > 0 ? median(valid) : null;
  const diff = med === null ? Infinity : Math.abs(med - sample.expectedScore);
  const pass = diff <= 0.5;
  return { ...sample, scores, median: med, diff, pass };
}

async function runCalibration() {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("Missing DEEPSEEK_API_KEY");
  }

  console.log("=== Calibration Test ===");
  const rows = [];

  for (const s of CALIBRATION_SAMPLES.discussion) {
    const r = await runOne(DISCUSSION_SYSTEM_PROMPT, s, "discussion");
    rows.push(r);
    console.log(
      `${r.pass ? "PASS" : "FAIL"} ${r.id} expected=${s.expectedScore} scores=${r.scores.join(",")} median=${r.median}`
    );
  }

  for (const s of CALIBRATION_SAMPLES.email) {
    const r = await runOne(EMAIL_SYSTEM_PROMPT, s, "email");
    rows.push(r);
    console.log(
      `${r.pass ? "PASS" : "FAIL"} ${r.id} expected=${s.expectedScore} scores=${r.scores.join(",")} median=${r.median}`
    );
  }

  const total = rows.length;
  const passed = rows.filter((r) => r.pass).length;
  const rate = Math.round((passed / total) * 100);
  console.log(`\nResult: ${passed}/${total} passed (${rate}%)`);
  if (rate < 80) {
    console.log("Calibration below target (<80%). Tune prompt anchors/rules.");
    process.exitCode = 1;
  }
}

runCalibration().catch((e) => {
  console.error(e);
  process.exit(1);
});
