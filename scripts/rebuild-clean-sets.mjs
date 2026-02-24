/**
 * rebuild-clean-sets.mjs
 * 从 questions.json 去重，筛选出 54 道唯一题目，重新组成 5 组（每组 10 题：1 easy + 7 medium + 2 hard）
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BANK_PATH = path.join(__dirname, "../data/buildSentence/questions.json");
const OUT_PATH = BANK_PATH;

const data = JSON.parse(readFileSync(BANK_PATH, "utf8"));
const all = data.question_sets.flatMap((s) => s.questions);

// 1. 按 answer 去重，保留首次出现
const seenAnswers = new Set();
const unique = [];
for (const q of all) {
  const key = q.answer.toLowerCase().trim();
  if (!seenAnswers.has(key)) {
    seenAnswers.add(key);
    unique.push(q);
  }
}
console.log(`去重后唯一题数: ${unique.length}`);

// 2. 按 id 建索引，便于下面按 id 引用原始完整数据
const byId = Object.fromEntries(unique.map((q) => [q.id, q]));

// ─────────────────────────────────────────────
// 3. 手工编排 5 组（每组 1 easy + 7 medium + 2 hard）
//    —— 确保无重复答案、无重复句型扎堆 ——
// ─────────────────────────────────────────────
const SETS = [
  {
    // SET 1：embedded when/where/if、negation、passive
    easy:   ["ets_s8_q5"],   // "The desk you ordered arrived this morning."
    hard:   ["ets_s2_q6",    // "He asked me why the report was not submitted on time."
              "ets_s3_q7"],  // "She asked whether the proposal had been approved by the committee."
    medium: [
      "ets_s1_q1",  // "Could you tell me when the results will be posted?" (Q:true, emb when)
      "ets_s1_q2",  // "The draft was not ready before the deadline." (neg)
      "ets_s1_q5",  // "She wanted to know where the tutorial would be held." (emb where)
      "ets_s2_q3",  // "He did not understand why the system was offline." (emb why, neg)
      "ets_s2_q5",  // "The report was revised by our section last night." (passive)
      "ets_s4_q3",  // "She was wondering if she could join a different project." (emb if, modal)
      "ets_s6_q3",  // "They were wondering if the professor had changed the timeline." (emb if, past perf)
    ],
  },
  {
    // SET 2：contact clause、no longer、curious about、reported if
    easy:   ["ets_s3_q2"],   // "The desk you ordered will arrive next Tuesday."
    hard:   ["ets_s4_q5",    // "He asked me why the project was no longer on schedule."
              "ets_s15_q1"], // "The announcement said the train was delayed because of an accident."
    medium: [
      "ets_s1_q3",  // "She was curious about where I bought my new laptop." (emb about where)
      "ets_s1_q4",  // "The assignment will no longer count toward the final grade." (neg no longer)
      "ets_s1_q7",  // "I have no idea what the advisor meant." (emb what, neg)
      "ets_s2_q2",  // "She needed to know if the position required previous experience." (emb if)
      "ets_s3_q8",  // "The report was revised by our team late last night." (passive)
      "ets_s5_q2",  // "She wanted to know where the workshop would be held." (emb where)
      "ets_s8_q9",  // "They were wondering if the professor had changed the dataset." (emb if, past perf)
    ],
  },
  {
    // SET 3：Q:true、found out where、complex how、passive progressive
    easy:   ["ets_s1_q9"],   // "The tutor shared the slides after class this morning."
    hard:   ["ets_s2_q1",    // "She wanted to know how we were able to make improvements."
              "ets_s10_q2"], // "He found out where the new road was being built."
    medium: [
      "ets_s1_q6",   // "He needed to know why the project was delayed." (emb why, pass)
      "ets_s1_q8",   // "Could you tell me when the final results will be posted?" (Q:true, emb when)
      "ets_s4_q1",   // "He wanted to know if I finished the report." (emb if)
      "ets_s4_q4",   // "She wanted to know where the studio would be held." (emb where)
      "ets_s4_q8",   // "The report was revised by the research group late last night." (passive)
      "ets_s7_q3",   // "She wanted to know why I was not at the party." (emb why, neg)
      "ets_s10_q10", // "They were wondering if the professor had changed the proposal." (emb if, past perf)
    ],
  },
  {
    // SET 4：contact clause、no longer sells、could not、emb what time
    easy:   ["ets_s5_q6"],   // "The desk I ordered last week arrived this morning."
    hard:   ["ets_s10_q9",   // "Emma found out where the new road was being built."
              "ets_s14_q7"], // "The bookstore I stopped by no longer sells used textbooks."
    medium: [
      "ets_s5_q7",   // "She wanted to know where the seminar would be held." (emb where)
      "ets_s5_q9",   // "The professor recommended the article I read last night." (contact clause)
      "ets_s6_q6",   // "They were wondering if the professor had changed the presentation." (emb if, past perf)
      "ets_s6_q9",   // "The report was revised by the lab group late last night." (passive)
      "ets_s8_q1",   // "She was wondering if she could get an extension." (emb if, modal)
      "ets_s10_q8",  // "I did not understand why the band started so late." (emb why, neg)
      "ets_s14_q2",  // "She wanted to know what time my interview had started." (emb what)
    ],
  },
  {
    // SET 5：could not、had no idea、asked why、simple negation
    easy:   ["ets_s12_q2"],  // "My colleague made the data much easier to analyze."
    hard:   ["ets_s15_q10",  // "She found out who was responsible for the project delay."
              "ets_s7_q8"],  // "I had no idea what the professor was discussing."
    medium: [
      "ets_s7_q2",   // "The report was revised by our committee late last night." (passive)
      "ets_s7_q9",   // "They were wondering if the professor had changed the rubric." (emb if, past perf)
      "ets_s9_q4",   // "She asked me what time the workshop would start." (emb what)
      "ets_s11_q1",  // "I could not hear the singer clearly from my seat." (neg could not)
      "ets_s12_q3",  // "I have no idea what his decision will be." (emb what, neg, future)
      "ets_s13_q7",  // "I did not attend the workshop last week." (neg did not)
      "ets_s14_q9",  // "She asked me why we chose to travel by train." (emb why)
    ],
  },
];

// ─────────────────────────────────────────────
// 4. 校验 & 组装
// ─────────────────────────────────────────────
const allUsedIds = new Set();
const allUsedAnswers = new Set();
let valid = true;

for (let si = 0; si < SETS.length; si++) {
  const s = SETS[si];
  const setIds = [...s.easy, ...s.hard, ...s.medium];
  if (setIds.length !== 10) {
    console.error(`❌ Set ${si + 1} 题数不是 10，而是 ${setIds.length}`);
    valid = false;
  }
  for (const id of setIds) {
    if (!byId[id]) {
      console.error(`❌ ID 不存在: ${id}`);
      valid = false;
    }
    if (allUsedIds.has(id)) {
      console.error(`❌ ID 重复使用: ${id}`);
      valid = false;
    }
    allUsedIds.add(id);
    const ans = byId[id]?.answer?.toLowerCase().trim();
    if (allUsedAnswers.has(ans)) {
      console.error(`❌ answer 重复: ${ans}`);
      valid = false;
    }
    allUsedAnswers.add(ans);
  }
}

if (!valid) {
  console.error("校验失败，已中止，未写入文件。");
  process.exit(1);
}

// 5. 生成新的 question_sets
const question_sets = SETS.map((s, si) => {
  const setNum = si + 1;
  // 顺序：easy first, then medium, then hard at end（符合题型从简到繁）
  const orderedIds = [...s.easy, ...s.medium, ...s.hard];
  const questions = orderedIds.map((origId, qi) => {
    const orig = byId[origId];
    return {
      ...orig,
      id: `ets_s${setNum}_q${qi + 1}`,
    };
  });
  return { set_id: setNum, questions };
});

const output = {
  version: "1.3",
  generated_at: new Date().toISOString(),
  question_sets,
};

writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), "utf8");

// 6. 打印摘要
console.log(`\n✅ 写入成功: ${OUT_PATH}`);
console.log(`   题组数: ${question_sets.length}`);
console.log(`   总题数: ${question_sets.reduce((n, s) => n + s.questions.length, 0)}`);
console.log(`   （已丢弃 ${all.length - allUsedIds.size} 道重复/冗余题，保留 ${allUsedIds.size} 道唯一题）\n`);

question_sets.forEach((s) => {
  console.log(`Set ${s.set_id}:`);
  s.questions.forEach((q) => {
    const tag = s.questions.indexOf(q) === 0 ? "[E]" :
      s.questions.indexOf(q) >= 8 ? "[H]" : "[M]";
    console.log(`  ${tag} ${q.id}: ${q.answer}`);
  });
  console.log();
});
