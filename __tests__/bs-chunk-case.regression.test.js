/**
 * 造句题句首词块不许大写（真数据 + 规则单测）。
 *
 * 为什么要这一条：真题专区造句是看图/文本照抄原卷的，答案句首词大写被原样抄进词块
 * （"Which" / "Do you"），考生一眼就知道哪块放第一个 —— 真考界面词块全是小写。
 * 2026-09-17 回填了 172 处；build_bank 落库前与个人题库读取时都走 lib/questionBank/bsChunkCase.js。
 * 句首词是专有名词（人名、地名、星期、语言）时必须保留大写，下面的单测钉住这些例外。
 */
const fs = require("fs");
const path = require("path");
const { findSentenceInitialCapChunks, normalizeSentenceInitialChunkCase } = require("../lib/questionBank/bsChunkCase");

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", rel), "utf8"));

describe("findSentenceInitialCapChunks / normalizeSentenceInitialChunkCase", () => {
  test("把句首大写词块改回小写（单词块 / 多词块 / 带逗号）", () => {
    const q = {
      prompt: "I'm thinking about getting a new laptop.",
      answer: "Which brand are you considering?",
      chunks: ["considering", "brand", "Which", "you"],
    };
    expect(normalizeSentenceInitialChunkCase(q).chunks).toEqual(["considering", "brand", "which", "you"]);
    expect(normalizeSentenceInitialChunkCase({ answer: "Do you know if it opens?", chunks: ["if it", "Do you", "opens", "know"] }).chunks)
      .toEqual(["if it", "do you", "opens", "know"]);
    expect(normalizeSentenceInitialChunkCase({ answer: "No, I missed the talk.", chunks: ["the talk", "No, I missed"] }).chunks)
      .toEqual(["the talk", "no, I missed"]);
  });

  test("不改原对象；没有要改的原样返回同一个对象", () => {
    const q = { answer: "What time is it?", chunks: ["What", "time", "it"] };
    const out = normalizeSentenceInitialChunkCase(q);
    expect(q.chunks[0]).toBe("What");
    expect(out.chunks[0]).toBe("what");
    const clean = { answer: "What time is it?", chunks: ["what", "time", "it"] };
    expect(normalizeSentenceInitialChunkCase(clean)).toBe(clean);
  });

  test("与被改词块同文的干扰项一起改（distractors[] 与 distractor 两种形状）", () => {
    expect(normalizeSentenceInitialChunkCase({ answer: "Did you go?", chunks: ["Did", "you", "go", "Did"], distractors: ["Did"] }).distractors)
      .toEqual(["did"]);
    expect(normalizeSentenceInitialChunkCase({ answer: "Did you go?", chunks: ["Did", "you", "go"], distractor: "does" }).distractor)
      .toBe("does");
  });

  test("I 系列、星期月份、语言国籍保留大写", () => {
    for (const [answer, chunk] of [
      ["I think so.", "I think"],
      ["I'm not sure.", "I'm not"],
      ["Monday works for me.", "Monday"],
      ["English is my favorite subject.", "English"],
    ]) {
      expect(findSentenceInitialCapChunks({ answer, chunks: [chunk, "x"] })).toEqual([]);
    }
  });

  test("题干或答案句中间也以大写出现的词（人名地名）保留大写", () => {
    expect(findSentenceInitialCapChunks({
      prompt: "Did Sam call you back?", answer: "Sam called me this morning.", chunks: ["Sam", "called me", "this morning"],
    })).toEqual([]);
    // 题干里 What 在句首（句号之后）不算「句中大写」，照改
    expect(findSentenceInitialCapChunks({
      prompt: "I'm hungry. What should we eat?", answer: "What about pizza?", chunks: ["What", "about", "pizza"],
    })).toHaveLength(1);
  });

  test("同一词块后面跟着大写词（Professor Lee / New York）保留大写", () => {
    expect(findSentenceInitialCapChunks({ answer: "Professor Lee canceled class.", chunks: ["Professor Lee", "canceled class"] })).toEqual([]);
    expect(findSentenceInitialCapChunks({ answer: "New York is huge.", chunks: ["New York", "is huge"] })).toEqual([]);
    // 后面跟的是 I 不算专有名词
    expect(findSentenceInitialCapChunks({ answer: "No, I didn't.", chunks: ["No, I", "didn't"] })).toHaveLength(1);
  });

  test("句中的大写专有名词不碰", () => {
    expect(findSentenceInitialCapChunks({
      answer: "Can you tell me if you visited Tokyo?", chunks: ["can you tell me", "if you", "visited", "Tokyo"],
    })).toEqual([]);
  });

  test("句首是题干给定词（不在词块里）时不误伤", () => {
    expect(findSentenceInitialCapChunks({ answer: "The library closes early.", chunks: ["library", "closes", "early"] })).toEqual([]);
  });
});

describe("真数据：各造句题库没有句首大写的词块", () => {
  const offenders = (items) => items
    .map((q) => ({ id: q.id, fixes: findSentenceInitialCapChunks(q) }))
    .filter((x) => x.fixes.length)
    .map((x) => `${x.id}: ${x.fixes.map((f) => f.from).join(", ")}`);

  test("真题专区 data/realBank/writing/bs.json", () => {
    expect(offenders(readJson("data/realBank/writing/bs.json").items)).toEqual([]);
  });

  test("主库 data/buildSentence/questions.json", () => {
    const bank = readJson("data/buildSentence/questions.json");
    expect(offenders(bank.question_sets.flatMap((s) => s.questions))).toEqual([]);
  });
});
