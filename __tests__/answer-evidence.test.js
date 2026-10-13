import { verifyEvidence, answerEvidenceFor, evidenceKey, normalizeIds, parseVote, quoteInSentences, vocabTargetEvidence } from "../lib/qa/answerEvidence";
import { numberSentences, buildEvidence } from "../lib/qa/questionQa";

const PASSAGE = "Farmers use cover crops. These plants anchor the soil at 7 a.m. daily.\n\nDr. Lee disagrees. She says yields fall.";
const sentences = numberSentences(PASSAGE);

describe("verifyEvidence：两票合并", () => {
  test("两票句号有交集、引文在交集句里 → ok，只留交集", () => {
    const r = verifyEvidence([{ ids: ["S2", "S1"], quote: "anchor the soil" }, { ids: ["S2"], quote: "anchor the soil" }], sentences);
    expect(r).toEqual({ status: "ok", ids: ["S2"], sentences: [sentences[1].text], quote: "anchor the soil" });
  });
  test("两票无交集 → disputed", () => {
    expect(verifyEvidence([{ ids: ["S1"], quote: "cover crops" }, { ids: ["S3"], quote: "disagrees" }], sentences).status).toBe("disputed");
  });
  test("引文是编的 → disputed；一票失败 → 有效票不足", () => {
    expect(verifyEvidence([{ ids: ["S2"], quote: "holds the dirt" }, { ids: ["S2"], quote: "holds the dirt" }], sentences).reason).toBe("引文在所标句子里找不到");
    expect(verifyEvidence([{ ids: ["S2"], quote: "anchor" }, null], sentences).reason).toBe("有效票不足");
  });
  test("不存在的句号丢掉；只跑一票时一票就够", () => {
    expect(verifyEvidence([{ ids: ["S99", "2"], quote: "anchor" }], sentences)).toMatchObject({ status: "ok", ids: ["S2"] });
  });
});

describe("answerEvidenceFor：运行时按原文对回句号", () => {
  const detail = { qid: evidenceKey("real_ap_1", 0), stem: "The word anchor is closest in meaning to", passage: PASSAGE, correct: "B", options: { A: "x", B: "y" } };
  const data = { items: { "real_ap_1-q0": { stem: detail.stem.slice(0, 80), status: "ok", ids: ["S2"], sentences: [sentences[1].text] } } };
  test("键、题干都对得上 → 当前句号", () => {
    expect(answerEvidenceFor(data, detail, sentences)).toEqual({ ids: ["S2"], sentences: [sentences[1].text] });
  });
  test("题干对不上 / 没有这题 / disputed / 原文里找不到这句 → null", () => {
    expect(answerEvidenceFor(data, { ...detail, stem: "other" }, sentences)).toBe(null);
    expect(answerEvidenceFor(data, { ...detail, qid: "x" }, sentences)).toBe(null);
    expect(answerEvidenceFor({ items: { "real_ap_1-q0": { ...data.items["real_ap_1-q0"], status: "disputed" } } }, detail, sentences)).toBe(null);
    expect(answerEvidenceFor({ items: { "real_ap_1-q0": { ...data.items["real_ap_1-q0"], sentences: ["Not in passage at all."] } } }, detail, sentences)).toBe(null);
    expect(answerEvidenceFor(null, detail, sentences)).toBe(null);
  });
  test("buildEvidence 带上依据句一行", () => {
    const key = answerEvidenceFor(data, detail, sentences);
    expect(buildEvidence(detail, null, key).text).toContain("答案依据句（离线标注，两次独立标注一致，供参考；与原文冲突时以原文为准）：[S2]");
    expect(buildEvidence(detail).text).not.toContain("答案依据句");
  });
});

describe("标注输出解析：句号写法与坏 JSON", () => {
  test("各种句号写法统一成 S 编号，范围展开", () => {
    expect(normalizeIds("S7")).toEqual(["S7"]);
    expect(normalizeIds(["[S7]", "8"])).toEqual(["S7", "S8"]);
    expect(normalizeIds(["S3-S5"])).toEqual(["S3", "S4", "S5"]);
    expect(normalizeIds("S7, S9")).toEqual(["S7", "S9"]);
    expect(normalizeIds(null)).toEqual([]);
  });
  test("正常 JSON、ids 是字符串、包在代码块里都能解析", () => {
    expect(parseVote('{"ids":["S2"],"quote":"anchor the soil"}')).toMatchObject({ ids: ["S2"], quote: "anchor the soil" });
    expect(parseVote('```json\n{"ids":"S2","quote":"anchor"}\n```')).toMatchObject({ ids: ["S2"], quote: "anchor" });
  });
  test("引文里有没转义的引号导致 JSON 坏掉 → 从字面上抠出句号和引文", () => {
    const v = parseVote('{"ids":["S2"],"quote":"the so-called "anchor" effect"}');
    expect(v.ids).toEqual(["S2"]);
    expect(v.quote).toContain("anchor");
  });
  test("空输出 → ids 为空、留下 raw", () => {
    expect(parseVote("")).toEqual({ ids: [], quote: "", raw: "" });
  });
});

describe("引文核对：分号拼接、跨句", () => {
  const texts = [sentences[0].text, sentences[1].text];
  test("分号拼起来的几段、跨两句的引文都认", () => {
    expect(quoteInSentences("use cover crops; anchor the soil", texts)).toBe(true);
    expect(quoteInSentences("Farmers use cover crops. These plants anchor the soil", texts)).toBe(true);
    expect(verifyEvidence([{ ids: ["S1", "S2"], quote: "cover crops; anchor the soil" }, { ids: ["S1", "S2"], quote: "x" }], sentences).status).toBe("ok");
  });
  test("有一段是编的就不认", () => {
    expect(quoteInSentences("use cover crops; holds the dirt", texts)).toBe(false);
  });
});

describe("词汇题按原词定位依据句", () => {
  const s = numberSentences("Rome fell. This decentralization fostered chronic instability. Monasteries kept fostering education.");
  const q = { question_type: "vocabulary_in_context", stem: 'The word "fostered" in the passage is closest in meaning to' };
  test("整词命中那一句，同根词不算", () => {
    expect(vocabTargetEvidence({ stem: q.stem, question: q }, s)).toEqual({ ids: ["S2"], sentences: [s[1].text] });
  });
  test("标注没收时 answerEvidenceFor 退回原词定位；非词汇题仍返回 null", () => {
    const data = { items: { "x-q0": { stem: q.stem.slice(0, 80), status: "disputed", reason: "两票句号无交集" } } };
    expect(answerEvidenceFor(data, { qid: "x-q0", stem: q.stem, question: q }, s)?.ids).toEqual(["S2"]);
    expect(answerEvidenceFor(data, { qid: "x-q0", stem: "Why does the author mention X?", question: { question_type: "rhetorical_purpose" } }, s)).toBeNull();
  });
  test("原词出现在两句里 → 不定位", () => {
    const s2 = numberSentences("It fostered trade. It also fostered war.");
    expect(vocabTargetEvidence({ stem: q.stem, question: q }, s2)).toBeNull();
  });
});
