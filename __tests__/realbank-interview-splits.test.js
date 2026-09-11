/**
 * 拼盘面试切分（lib/realExam/interviewSplits.mjs + data/realBank/speaking/interview-splits.json）。
 *
 * 锁三件事：
 *   1. 纯函数按表拆：4 问成套、问题 id 不变（音频跟 id 走）、position 重编 Q1-Q4、尾巴不入库、表外 item 原样通过、幂等；
 *   2. 缺题的 chunk（问题被复核清单下架）整套跳过并记 skipped，绝不出 3 问的「套」；
 *   3. 仓库里的切分表与当前 interview.json 自洽：每套恰 4 问、id 不重复、库里已是拆后形态（幂等再跑无变化）。
 */
const fs = require("fs");
const path = require("path");
const { expandInterviewSplits } = require("../lib/realExam/interviewSplits.mjs");
const { parseRealBankId } = require("../lib/realExam/blueprint.mjs");

const q = (id) => ({ id, position: "Q9", question: `text ${id}`, audio_url: `https://x/${id}.mp3` });
const big = {
  id: "real_interview_rp9_1", source: "rp9", date: "2026-09-09", intro: "orig intro", topic: "",
  questions: ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9"].map((n) => q(`real_interview_rp9_1_${n}`)),
};
const plain = { id: "real_interview_rf1_1", source: "rf1", intro: "rf", questions: ["q1", "q2", "q3", "q4"].map((n) => q(`real_interview_rf1_1_${n}`)) };
const manifest = {
  splits: {
    real_interview_rp9_1: [
      { chunk: 1, topic: "A", intro: "intro A", question_ids: ["real_interview_rp9_1_q1", "real_interview_rp9_1_q2", "real_interview_rp9_1_q3", "real_interview_rp9_1_q4"] },
      { chunk: 2, topic: "B", intro: "intro B", question_ids: ["real_interview_rp9_1_q5", "real_interview_rp9_1_q6", "real_interview_rp9_1_q7", "real_interview_rp9_1_q8"] },
    ],
  },
};

describe("expandInterviewSplits", () => {
  test("按表拆成 4 问一套，问题 id 不变、position 重编，尾巴不入库，表外 item 原样", () => {
    const { items, stats } = expandInterviewSplits([big, plain], manifest);
    expect(items.map((x) => x.id)).toEqual(["real_interview_rp9_1_c1", "real_interview_rp9_1_c2", "real_interview_rf1_1"]);
    const c2 = items[1];
    expect(c2.intro).toBe("intro B");
    expect(c2.topic).toBe("B");
    expect(c2.split_from).toBe("real_interview_rp9_1");
    expect(c2.source).toBe("rp9");
    expect(c2.questions.map((x) => x.id)).toEqual(["real_interview_rp9_1_q5", "real_interview_rp9_1_q6", "real_interview_rp9_1_q7", "real_interview_rp9_1_q8"]);
    expect(c2.questions.map((x) => x.position)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(c2.questions[0].audio_url).toBe("https://x/real_interview_rp9_1_q5.mp3");
    expect(stats).toEqual({ split: 1, chunks: 2, dropped_questions: 1, skipped: [] });
    expect(items[2]).toBe(plain);
  });

  test("幂等：拆过的再过一遍不变", () => {
    const once = expandInterviewSplits([big, plain], manifest).items;
    const twice = expandInterviewSplits(once, manifest);
    expect(twice.items).toEqual(once);
    expect(twice.stats.split).toBe(0);
  });

  test("chunk 里有问题不在库里（被下架）→ 整套跳过并记 skipped；全跳则原样保留", () => {
    const held = { ...big, questions: big.questions.filter((x) => !x.id.endsWith("_q6")) };
    const { items, stats } = expandInterviewSplits([held], manifest);
    expect(items.map((x) => x.id)).toEqual(["real_interview_rp9_1_c1"]);
    expect(stats.skipped).toEqual([{ id: "real_interview_rp9_1", chunk: 2, why: expect.stringContaining("real_interview_rp9_1_q6") }]);
    const none = expandInterviewSplits([held], { splits: { real_interview_rp9_1: [manifest.splits.real_interview_rp9_1[1]] } });
    expect(none.items).toEqual([held]);
  });

  test("blueprint 认得 _cN 后缀", () => {
    expect(parseRealBankId("real_interview_rp0704_1_c2")).toEqual({ type: "interview", slug: "rp0704", module: 1, q: null, seq: 1, chunk: 2 });
    expect(parseRealBankId("real_repeat_rp0704_1_c3")).toEqual({ type: "repeat", slug: "rp0704", module: 1, q: null, seq: 1, chunk: 3 });
  });
});

describe("仓库切分表与 interview.json 自洽", () => {
  const dir = path.join(process.cwd(), "data", "realBank", "speaking");
  const bankPath = path.join(dir, "interview.json");
  const manPath = path.join(dir, "interview-splits.json");
  const present = fs.existsSync(bankPath) && fs.existsSync(manPath);
  const maybe = present ? test : test.skip;

  maybe("每套恰 4 问、问题 id 全表不重复、库里已是拆后形态", () => {
    const man = JSON.parse(fs.readFileSync(manPath, "utf8"));
    const bank = JSON.parse(fs.readFileSync(bankPath, "utf8"));
    const seen = new Set();
    for (const [id, list] of Object.entries(man.splits)) {
      for (const c of list) {
        expect({ id, chunk: c.chunk, n: c.question_ids.length }).toEqual({ id, chunk: c.chunk, n: 4 });
        for (const qid of c.question_ids) { expect(seen.has(qid)).toBe(false); seen.add(qid); }
      }
    }
    // 库里不再有表键对应的大集；每个 chunk 都在库里且恰 4 问
    const ids = new Set(bank.items.map((x) => x.id));
    for (const [id, list] of Object.entries(man.splits)) {
      expect(ids.has(id)).toBe(false);
      for (const c of list) {
        const set = bank.items.find((x) => x.id === `${id}_c${c.chunk}`);
        expect(set && set.questions.map((x) => x.id)).toEqual(c.question_ids);
      }
    }
    expect(expandInterviewSplits(bank.items, man).stats.split).toBe(0);
  });
});
