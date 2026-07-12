/* eslint-disable no-console */
// End-to-end scoring calibration against the PRODUCTION pipeline:
//   production system prompt → DeepSeek → parseReport → calibrateScoreReport
//
// 之前的版本用一套独立英文 prompt + 手工正则护栏（"really enjoyed" /
// "subscriber of" 等短语列表）近似线上行为——那些短语是从两篇校准样文里
// 逐字抄出来的，导致每次「校准」其实是在记忆样本，线上评分持续偏严。
// 现在直接调用生产模块，脚本测的就是用户真实经过的整条链路。
//
// Usage:
//   PowerShell:  $env:DEEPSEEK_API_KEY="sk-xxx"; npm run calibration:test
//   Bash:        DEEPSEEK_API_KEY=sk-xxx npm run calibration:test

const { callDeepSeekViaCurl, resolveProxyUrl } = require("../lib/ai/deepseekHttp");
// ETS 官方带分样文（金标锚点）：官方评分员给分 + 评语，来源见文件内 sources 字段。
const ETS_GOLDEN = require("../data/writingScoring/etsGoldenSamples.json");

const RUNS_PER_SAMPLE = 3;
const TOLERANCE = 0.5;

const CALIBRATION_SAMPLES = {
  discussion: [
    {
      id: "cal-disc-5",
      expectedScore: 5,
      promptData: {
        professor: { name: "Professor Diaz", text: "What is the most important invention in history?" },
        students: [
          { name: "Student A", text: "I think the internet is the most important invention." },
          { name: "Student B", text: "I believe the printing press changed the world most." },
        ],
      },
      response:
        "While both the internet and printing press transformed communication, I would argue that the airplane represents the most significant invention in history. Before aviation, international trade and cultural exchange were limited to those who could afford lengthy sea voyages. The development of commercial flight by figures like Santos-Dumont democratized global travel, enabling millions to cross borders that were previously impassable. Furthermore, aviation catalyzed advances in materials science and engineering that led to innovations in other fields. Although the internet connects us digitally, the airplane first connected us physically, laying the groundwork for the globalized world we inhabit today.",
    },
    {
      id: "cal-disc-4",
      expectedScore: 4,
      promptData: {
        professor: { name: "Professor Diaz", text: "What is the most important invention in history?" },
        students: [
          { name: "Student A", text: "I think the internet is the most important invention." },
          { name: "Student B", text: "I believe the printing press changed the world most." },
        ],
      },
      response:
        "I think the airplane is the most important invention. Before airplanes, people could only travel by ship or train, which took very long time. When airplane was invented, people could go to other countries much faster and this changed how we do business and tourism. I agree with Student B that printing press was important, but I think transportation had bigger impact because it allowed people to actually meet face to face. Also airplane technology helped develop other technologies too. So I believe airplane changed the world more than any other invention.",
    },
    {
      id: "cal-disc-3",
      expectedScore: 3,
      promptData: {
        professor: { name: "Professor Diaz", text: "What is the most important invention in history?" },
        students: [
          { name: "Student A", text: "I think the internet is the most important invention." },
          { name: "Student B", text: "I believe the printing press changed the world most." },
        ],
      },
      response:
        "I think airplane is very important invention. It help people to travel fast. Before airplane people use ship and it take long time. Airplane make the world small. I agree airplane is important because we can go anywhere. Also it is good for business. Many people use airplane every day. So I think airplane is most important invention in history. It change our life a lot.",
    },
    {
      id: "cal-disc-2",
      expectedScore: 2,
      promptData: {
        professor: { name: "Professor Diaz", text: "What is the most important invention in history?" },
        students: [
          { name: "Student A", text: "I think the internet is the most important invention." },
          { name: "Student B", text: "I believe the printing press changed the world most." },
        ],
      },
      response:
        "Invention is very important for people life. Many invention help us. I think important invention is airplane because fast. And also internet is important invention too. We need invention for make life better. Student say internet and printing is important, I think all invention important.",
    },
  ],
  email: [
    {
      // 满任务完成 + 十余处「能力型」小错（动词形态/主谓一致/词性），全部不影响理解。
      // 错误画像与官方 4 分样文（ets-disc-4-lightbulb：多处小错让读者分神但意思清楚）
      // 同类 → 按官方梯子锚定 4.0。真实用户案例（2026-07）：竞品评 5.1/6（虚高），
      // 本站曾只给 3.5（偏严）。
      id: "cal-email-4-heating",
      expectedScore: 4,
      promptData: {
        scenario:
          "Your apartment's heating system stopped working last week. You have already tried adjusting the thermostat, but the radiators remain cold.",
        direction: "Write an email to Mr. Harris. In your email, do the following:",
        to: "Mr. Harris",
        subject: "Heating system problem",
        goals: [
          "Describe the problem with the heating system.",
          "Explain how the problem has affected your daily life.",
          "Request a specific repair arrangement or solution.",
        ],
      },
      response:
        "Dear Mr. Harris,\nI am writing to inform you about a problem about the heating system in my apartment. I moved in recently, and since last week, the heater has completely stop working. No matter how I adjust the thermostat, the radiators is still cold, and the temperature in the apartment has dropped a lot, especially at night.\nThis issue has starting to affect my daily life and study routine in a big way. Because my apartment is so cold, I have trouble to concentrate on my coursework, and I often need to stop studying early just for warm up under blankets. I also have difficulty to sleep well, which makes me feeling tired and less productive during the day.\nBecause of these effects, I would like to request that a repair technician can be sent to check and fix the heating system as soon as possible, ideally in the next two or three days. If the full repair will take more longer, I will appreciate if you can give me a temporary space heater so I can continue my daily activities comfortable.\nThank you for your attention on this matter. I look forward for your response soon.\nBest regards,\nLisa",
    },
    {
      id: "cal-email-4-poetry",
      expectedScore: 4,
      promptData: {
        scenario:
          "You are a subscriber of the poetry magazine Verse & Voice. Last week you tried to submit a poem through the magazine's online form and the page showed an error message.",
        direction: "Write an email to the editor. In your email, do the following:",
        to: "Ms. Rowe",
        subject: "Poem submission question",
        goals: [
          "Express your appreciation for the magazine.",
          "Describe the technical issue you experienced.",
          "Ask about the status of your submission.",
        ],
      },
      response:
        "Dear Ms. Rowe,\n\nI am writing to explain a problem I had with the online submission form. I am a subscriber of Verse & Voice, and I really enjoy reading your magazine.\n\nI tried to submit a poem through your online form last week. After I clicked the Submit button, the page showed an error message. I am not sure whether my poem was successfully received or not.\n\nCould you please let me know if my submission went through? If not, I would be happy to submit it again.\n\nSincerely,\nZishuo",
    },
    {
      // Goal1 要求 mention a specific point，正文只有 "this point" 未具体化
      // → 1 个 PARTIAL，语言干净 → 3.5 左右（旧脚本因短语命中硬压到 3，
      // 那是样本记忆不是评分标准）。
      id: "cal-email-35-lecture",
      expectedScore: 3.5,
      promptData: {
        scenario:
          "You attended a guest lecture by Dr. Thompson on campus last week and found it inspiring.",
        direction: "Write an email to Dr. Thompson. In your email, do the following:",
        to: "Dr. Thompson",
        subject: "Thank you for your lecture",
        goals: [
          "Thank Dr. Thompson and mention a specific point from the lecture.",
          "Explain how the lecture relates to your own interest.",
          "Ask for brief advice or recommended resources.",
        ],
      },
      response:
        "Dear Dr. Thompson,\n\nI am writing to thank you for the guest lecture you gave on campus last week. I really enjoyed your talk and this point left a strong impression on me.\n\nI am a senior student and I am choosing a topic for my thesis. After listening to your lecture, I started to think about changing my topic to marine biology, because it connects to my interest.\n\nI would like to ask if you would be willing to give me some brief advice or recommend resources.\n\nSincerely,\nZishuo",
    },
  ],
};

function median(nums) {
  const arr = [...nums].sort((a, b) => a - b);
  return arr[Math.floor(arr.length / 2)];
}

async function callDeepSeek(systemPrompt, userMessage) {
  return callDeepSeekViaCurl({
    apiKey: process.env.DEEPSEEK_API_KEY,
    proxyUrl: resolveProxyUrl(),
    timeoutMs: 150000,
    payload: {
      model: "deepseek-v4-flash",
      // 判分锚 v3 输出(含 ===ERRORS=== 推理段)实测需 3.1-3.9K tokens，与 writingEval 同预算
      max_tokens: 4000,
      temperature: 0.3,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    },
  });
}

async function runOne(libs, sample, mode) {
  const sys =
    mode === "discussion" ? libs.getDiscussionSystemPrompt("zh") : libs.getEmailSystemPrompt("zh");
  const userMsg =
    mode === "discussion"
      ? libs.buildDiscussionUserPrompt(sample.promptData, sample.response)
      : libs.buildEmailUserPrompt(sample.promptData, sample.response);

  const scores = [];
  for (let i = 0; i < RUNS_PER_SAMPLE; i += 1) {
    const output = await callDeepSeek(sys, userMsg);
    const parsed = libs.parseReport(output);
    if (parsed.error) {
      console.log(`  [warn] ${sample.id} run${i + 1}: parse failed (${parsed.errorReason})`);
      continue;
    }
    const calibrated = libs.calibrateScoreReport(mode, parsed, sample.response);
    if (Number.isFinite(calibrated.score)) scores.push(calibrated.score);
    // 诊断行：holistic=模型整体判档 weighted=三维加权 final=校准后最终分
    console.log(
      `    [${sample.id}] run${i + 1}: holistic=${parsed.score} weighted=${calibrated.calibration?.rawScore} final=${calibrated.score}${(calibrated.calibration?.reasons || []).length ? " (" + calibrated.calibration.reasons.join(",") + ")" : ""}`
    );
    await new Promise((r) => setTimeout(r, 1000));
  }

  const med = scores.length > 0 ? median(scores) : null;
  const diff = med === null ? Infinity : Math.abs(med - sample.expectedScore);
  const pass = diff <= TOLERANCE;
  return { id: sample.id, expectedScore: sample.expectedScore, scores, median: med, diff, pass };
}

async function runCalibration() {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("Missing DEEPSEEK_API_KEY");
  }

  // 生产模块是 ESM（Node 22 会自动按模块语法重新解析），用动态 import 载入。
  const [emailPrompts, discPrompts, parseMod, calibMod] = await Promise.all([
    import("../lib/ai/prompts/emailWriting.js"),
    import("../lib/ai/prompts/academicWriting.js"),
    import("../lib/ai/parse.js"),
    import("../lib/ai/calibration.js"),
  ]);
  const libs = {
    getEmailSystemPrompt: emailPrompts.getEmailSystemPrompt,
    buildEmailUserPrompt: emailPrompts.buildEmailUserPrompt,
    getDiscussionSystemPrompt: discPrompts.getDiscussionSystemPrompt,
    buildDiscussionUserPrompt: discPrompts.buildDiscussionUserPrompt,
    parseReport: parseMod.parseReport,
    calibrateScoreReport: calibMod.calibrateScoreReport,
  };

  console.log("=== Calibration Test (production pipeline) ===");
  const rows = [];

  // 金标在前：ETS 官方样文（预期分 = 官方评分员给分）
  for (const g of ETS_GOLDEN.items) {
    const sample = { id: `GOLD-${g.id}`, expectedScore: g.officialScore, promptData: g.promptData, response: g.response };
    const r = await runOne(libs, sample, g.task);
    rows.push(r);
    console.log(
      `${r.pass ? "PASS" : "FAIL"} ${r.id} expected=${r.expectedScore} scores=${r.scores.join(",")} median=${r.median}`
    );
  }

  for (const s of CALIBRATION_SAMPLES.discussion) {
    const r = await runOne(libs, s, "discussion");
    rows.push(r);
    console.log(
      `${r.pass ? "PASS" : "FAIL"} ${r.id} expected=${r.expectedScore} scores=${r.scores.join(",")} median=${r.median}`
    );
  }

  for (const s of CALIBRATION_SAMPLES.email) {
    const r = await runOne(libs, s, "email");
    rows.push(r);
    console.log(
      `${r.pass ? "PASS" : "FAIL"} ${r.id} expected=${r.expectedScore} scores=${r.scores.join(",")} median=${r.median}`
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
