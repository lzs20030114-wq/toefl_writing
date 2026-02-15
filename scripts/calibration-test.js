/* eslint-disable no-console */
// Usage:
//   set DEEPSEEK_API_KEY=sk-xxx && node scripts/calibration-test.js

const DISCUSSION_SYSTEM_PROMPT = `
你是ETS认证级别的托福写作评分专家。请严格按照ETS Academic Discussion 0-5分标准评分。
先诊断后打分，必须执行：
1) 立场清晰度
2) 论证质量（是否有具体理由/例子）
3) 互动性（是否回应教授/学生）
4) 逻辑连贯性
5) 语言准确性
6) 句式多样性
7) 综合评分
硬规则：
- 未明确立场：最高3分
- 未回应教授或任何学生：最高3分
- 无复合句：最高3分
- 空洞重复无新信息：最高2分
- 少于60词：最高2分
按以下格式输出：
===SCORE===
分数: [0-5]
Band: [1.0-5.5]
总评: [...]
===ANNOTATION===
...<r>...</r><n level="red|orange|blue" fix="...">...</n>...
===PATTERNS===
{"patterns":[{"tag":"...","count":1,"summary":"..."}]}
===COMPARISON===
[范文]
...
[对比]
1. ...
===ACTION===
短板1: ...
重要性: ...
行动: ...
`.trim();

const EMAIL_SYSTEM_PROMPT = `
你是ETS认证级别的托福写作评分专家。请严格按照ETS Write an Email 0-5分标准评分。
先诊断后打分，必须执行：
1) 三个Goal逐一判定（OK/PARTIAL/MISSING）
2) 语域得体性（格式与礼貌策略）
3) 细节充分度
4) 语言准确性
5) 综合评分（Goal40%+语域20%+细节20%+语言20%）
硬规则：
- 任一goal缺失：最高3分
- 两个以上goal是PARTIAL：最高3分
- 无正式开头或结尾：最高3分
- 少于50词：最高2分
按以下格式输出：
===SCORE===
分数: [0-5]
Band: [1.0-5.5]
总评: [...]
===GOALS===
Goal1: [OK|PARTIAL|MISSING] ...
Goal2: ...
Goal3: ...
===ANNOTATION===
...<r>...</r><n level="red|orange|blue" fix="...">...</n>...
===PATTERNS===
{"patterns":[{"tag":"...","count":1,"summary":"..."}]}
===COMPARISON===
[范文]
...
[对比]
1. ...
===ACTION===
短板1: ...
重要性: ...
行动: ...
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
  const m = String(text || "").match(/分数:\s*([0-5])/);
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
  if (wordCount(responseText) < 60) return score;
  if (!hasClearStance(responseText)) return score;
  if (reasonSignalCount(responseText) < 2) return score;
  return 3;
}

function median(nums) {
  const arr = [...nums].sort((a, b) => a - b);
  return arr[Math.floor(arr.length / 2)];
}

async function callDeepSeek(systemPrompt, userMessage) {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + process.env.DEEPSEEK_API_KEY,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      max_tokens: 2400,
      temperature: 0.3,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`DeepSeek ${res.status}: ${txt}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

async function runOne(systemPrompt, sample, mode) {
  const userMsg =
    mode === "discussion"
      ? `题目：${sample.prompt}\n\nStudent A: ${sample.studentA}\nStudent B: ${sample.studentB}\n\n考生回答：\n${sample.response}`
      : `题目：${sample.prompt}\n\n考生回答：\n${sample.response}`;

  const scores = [];
    for (let i = 0; i < 3; i += 1) {
      const output = await callDeepSeek(systemPrompt, userMsg);
    const rawScore = extractScore(output);
    const score =
      mode === "discussion"
        ? applyDiscussionGuardrail(rawScore, sample.response)
        : rawScore;
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
    console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id} expected=${s.expectedScore} scores=${r.scores.join(",")} median=${r.median}`);
  }
  for (const s of CALIBRATION_SAMPLES.email) {
    const r = await runOne(EMAIL_SYSTEM_PROMPT, s, "email");
    rows.push(r);
    console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id} expected=${s.expectedScore} scores=${r.scores.join(",")} median=${r.median}`);
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
