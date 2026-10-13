import { numberSentences } from "../lib/qa/questionQa";
import { evidenceKey, quoteInSentences } from "../lib/qa/answerEvidence";

const bank = require("../data/realBank/reading/ap.json");
const labels = require("../data/realBank/reading/distractor-labels.json");

// 规则见 docs/distractor-label-rules.md；类别名只能用表里的
// 按题型分表：词汇、指代、插入句各有一张表，其余题型用意义类表（反向题的干扰项另记「原文提到」）
const MEANING = ["与原文相反", "原文未提", "偷换概念", "范围扩大或缩小", "过度推断", "因果倒置", "答非所问", "其他", "原文提到"];
const BY_TYPE = {
  vocabulary_in_context: ["常见义非语境义", "形近或词根干扰", "不符合语境义", "其他"],
  reference: ["就近名词误指", "语义不通", "其他"],
  insert_text: ["指代或话题不衔接", "衔接词不对应", "打断逻辑链", "其他"],
};
const labelsFor = (type) => new Set(BY_TYPE[type] || MEANING);
const SUBLABELS = new Set(["沾边无据", "常识干扰", "毫不相关", "空泛套话"]);

const questions = new Map();
for (const it of bank.items || bank) {
  const sentences = numberSentences(it.passage);
  (it.questions || []).forEach((q, i) => questions.set(evidenceKey(it.id, i), { q, sentences }));
}

describe("学术阅读真题干扰项标注", () => {
  const entries = Object.entries(labels.items);

  test("每道有选项的题都标了，完整题干逐字对得上（题号挪位或题干改动会被拦下）", () => {
    const withOptions = [...questions.entries()].filter(([, { q }]) => Object.keys(q.options || {}).length > 1);
    expect(entries.length).toBe(withOptions.length);
    for (const [qid, entry] of entries) {
      const hit = questions.get(qid);
      expect(hit).toBeTruthy();
      expect(entry.stem).toBe(String(hit.q.stem).trim());
    }
  });

  test("只标错误选项，每个错误选项都有标签，且选项文案对得上（重建题库改了文案或互换选项会被拦下）", () => {
    const bad = [];
    for (const [qid, entry] of entries) {
      const { q } = questions.get(qid);
      const wrong = Object.keys(q.options).filter((k) => k !== q.correct_answer).sort();
      expect(Object.keys(entry.options).sort()).toEqual(wrong);
      for (const [k, o] of Object.entries(entry.options)) {
        if (o.text !== String(q.options[k]).trim()) bad.push(`${qid} ${k}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("类别和备选类别都在该题型的表里；子类只给「原文未提」", () => {
    const bad = [];
    for (const [qid, entry] of entries) {
      const allowed = labelsFor(questions.get(qid).q.question_type);
      for (const [opt, o] of Object.entries(entry.options)) {
        if (!allowed.has(o.label) || (o.alt != null && !allowed.has(o.alt))) bad.push(`${qid} ${opt}`);
        if (o.sublabel != null) {
          expect(o.label).toBe("原文未提");
          expect(SUBLABELS.has(o.sublabel)).toBe(true);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  test("置信度合法；high 不带备选类别，备选类别不等于本类，low 必带备选类别", () => {
    for (const [, entry] of entries) {
      for (const o of Object.values(entry.options)) {
        expect(["high", "medium", "low"]).toContain(o.confidence);
        if (o.confidence === "high") expect(o.alt).toBeUndefined();
        if (o.alt != null) expect(o.alt).not.toBe(o.label);
        if (o.confidence === "low") expect(o.alt).toBeTruthy();
      }
    }
  });

  test("依据句存在，原话逐字出自依据句", () => {
    const bad = [];
    for (const [qid, entry] of entries) {
      const { sentences } = questions.get(qid);
      for (const [opt, o] of Object.entries(entry.options)) {
        const texts = o.evidence.map((id) => sentences.find((s) => s.id === id)?.text);
        if (!o.evidence.length || texts.some((t) => !t) || !quoteInSentences(o.quote, texts)) bad.push(`${qid} ${opt}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
