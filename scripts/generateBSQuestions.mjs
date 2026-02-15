/**
 * Generate Build a Sentence question sets via DeepSeek API.
 *
 * Usage: node scripts/generateBSQuestions.mjs
 *
 * Requires DEEPSEEK_API_KEY in .env
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load .env manually
const envPath = resolve(__dirname, "..", ".env");
try {
  const envContent = readFileSync(envPath, "utf-8");
  envContent.split("\n").forEach(line => {
    const match = line.match(/^\s*([\w]+)\s*=\s*(.*)$/);
    if (match) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  });
} catch { /* no .env file */ }

const API_KEY = process.env.DEEPSEEK_API_KEY;
if (!API_KEY) {
  console.error("ERROR: DEEPSEEK_API_KEY not found in .env");
  process.exit(1);
}

// Load validation functions
const { validateQuestion, validateQuestionSet } = require("../lib/questionBank/buildSentenceSchema.js");
const { evaluateSetDifficultyAgainstTarget, formatDifficultyProfile } = require("../lib/questionBank/difficultyControl.js");

const OUTPUT_PATH = resolve(__dirname, "..", "data", "buildSentence", "questions.json");
const NUM_SETS = 5;
const QUESTIONS_PER_SET = 10;

const GRAMMAR_REQUIREMENTS = [
  "间接疑问句（embedded question）",
  "间接疑问句 + whether/if引导",
  "间接疑问句 + wh-词引导",
  "间接疑问句 + 被动语态",
  "间接疑问句 + wh-词引导（地点）",
  "一般疑问句 + want+宾语+to不定式",
  "一般疑问句 + send/give双宾语",
  "特殊疑问句 + 间接疑问句语序",
  "陈述句 + 间接疑问句（wonder）",
  "间接疑问句 + 时间状语从句",
];

const GEN_PROMPT = `你是一位 TOEFL iBT Writing Section Task 1 "Build a Sentence" 的出题专家。

## 任务
生成 ${QUESTIONS_PER_SET} 道 Build a Sentence 题目，输出为 JSON 数组。每道题须严格符合以下 schema：

{
  "id": "ets_sN_qM",
  "prompt": "对话情境句（5-15词，以?或.结尾）",
  "answer": "完整正确答案句（7-13词，自然流畅）",
  "chunks": ["多词块1", "多词块2", ...],
  "prefilled": [],
  "prefilled_positions": {},
  "distractor": null 或 "干扰词块",
  "has_question_mark": true/false,
  "grammar_points": ["语法点1", "语法点2"]
}

## 10 题语法点分配（按顺序生成）
${GRAMMAR_REQUIREMENTS.map((g, i) => `${i + 1}. ${g}`).join("\n")}

## chunks 规则
- chunks 数量：5-7 个（不含 distractor）
- 每个 chunk 最多 3 个词
- chunks 全部小写
- chunks（去掉 distractor）的所有词拼起来 = answer 的所有词（去掉标点后）
- distractor 的词不在 answer 中
- 恰好 2-3 道题有 distractor（非 null）

## 答案唯一性
- 每道题只能有一个语法正确且语义通顺的排列方式
- 避免介词短语可以在多个位置插入的情况

## prompt 情境
- 校园生活、学术讨论、图书馆、宿舍、课程选择等 TOEFL 常见场景

## 输出
仅输出 JSON 数组，不要输出任何其他文字。id 格式为 ets_s{SET_NUM}_q{1-10}。`;

const REVIEW_PROMPT = `你是一位英语语言学专家。请审核以下 Build a Sentence 题目：

1. 答案句是否自然流畅、语法正确？
2. chunks 排列是否只有唯一正确答案？（关键！如果有多种合理排列则不通过）
3. distractor（如有）是否真的不属于答案句？
4. prompt 情境是否合理？

如果全部通过，回复 "PASS"。
如果有问题，回复 "FAIL: " 加具体原因。

题目：
`;

async function callDeepSeek(prompt, temperature = 0.7) {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      temperature,
      max_tokens: 4096,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

function parseJsonArray(text) {
  // Extract JSON array from response
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON array found in response");
  return JSON.parse(match[0]);
}

async function generateOneSet(setNum) {
  console.log(`\n=== Generating Set ${setNum} ===`);

  const prompt = GEN_PROMPT.replace(/\{SET_NUM\}/g, String(setNum));
  let attempts = 0;
  const MAX_ATTEMPTS = 3;

  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    console.log(`  Attempt ${attempts}/${MAX_ATTEMPTS}...`);

    try {
      const raw = await callDeepSeek(prompt);
      const questions = parseJsonArray(raw);

      if (!Array.isArray(questions) || questions.length !== QUESTIONS_PER_SET) {
        console.log(`  Got ${questions?.length} questions, need ${QUESTIONS_PER_SET}. Retrying...`);
        continue;
      }

      // Fix IDs
      questions.forEach((q, i) => {
        q.id = `ets_s${setNum}_q${i + 1}`;
        // Ensure prefilled defaults
        if (!q.prefilled) q.prefilled = [];
        if (!q.prefilled_positions) q.prefilled_positions = {};
      });

      // Validate each question
      let allValid = true;
      for (let i = 0; i < questions.length; i++) {
        const result = validateQuestion(questions[i]);
        if (result.fatal.length > 0) {
          console.log(`  Q${i + 1} fatal errors:`, result.fatal);
          allValid = false;
        }
        if (result.format.length > 0) {
          console.log(`  Q${i + 1} format warnings:`, result.format);
        }
      }

      if (!allValid) {
        console.log("  Some questions have fatal errors. Retrying...");
        continue;
      }

      // AI review for uniqueness + naturalness
      console.log("  Running AI review...");
      const reviewText = REVIEW_PROMPT + JSON.stringify(questions, null, 2);
      const reviewResult = await callDeepSeek(reviewText, 0.3);
      console.log(`  Review result: ${reviewResult.substring(0, 100)}...`);

      if (!reviewResult.toUpperCase().includes("PASS")) {
        console.log("  AI review failed. Retrying...");
        continue;
      }

      // Validate set-level distribution
      const setResult = validateQuestionSet(questions);
      if (!setResult.ok) {
        console.log("  Set validation failed:", setResult.errors);
        // Don't retry for set-level — accept with warnings
        console.log("  (Accepting with set-level warnings)");
      }

      const diffResult = evaluateSetDifficultyAgainstTarget(questions);
      if (!diffResult.ok) {
        console.log(`  Difficulty profile drift: ${formatDifficultyProfile(diffResult)}`);
        console.log("  Retrying to get a better 10-question difficulty mix...");
        continue;
      }

      console.log(`  Set ${setNum} generated successfully!`);
      return { set_id: setNum, questions };

    } catch (e) {
      console.error(`  Error: ${e.message}`);
      if (attempts >= MAX_ATTEMPTS) throw e;
    }
  }

  throw new Error(`Failed to generate Set ${setNum} after ${MAX_ATTEMPTS} attempts`);
}

async function main() {
  console.log("Build a Sentence Question Generator");
  console.log("====================================");
  console.log(`Target: ${NUM_SETS} sets x ${QUESTIONS_PER_SET} questions`);

  const questionSets = [];

  for (let i = 1; i <= NUM_SETS; i++) {
    try {
      const set = await generateOneSet(i);
      questionSets.push(set);
    } catch (e) {
      console.error(`\nFailed to generate Set ${i}: ${e.message}`);
      console.log("Continuing with remaining sets...");
    }
  }

  if (questionSets.length === 0) {
    console.error("\nNo sets generated! Exiting.");
    process.exit(1);
  }

  const output = {
    version: "1.0",
    question_sets: questionSets,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf-8");
  console.log(`\nDone! Generated ${questionSets.length} sets → ${OUTPUT_PATH}`);

  // Summary
  questionSets.forEach(s => {
    const qCount = s.questions.length;
    const dCount = s.questions.filter(q => q.distractor).length;
    const qmCount = s.questions.filter(q => q.has_question_mark).length;
    console.log(`  Set ${s.set_id}: ${qCount} questions, ${dCount} distractors, ${qmCount} questions with ?`);
  });
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
