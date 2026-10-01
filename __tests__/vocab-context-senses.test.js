import { adoptContextSense, saveWord, getCard, chooseSense, writeBook, getVocabAccountKey } from "../lib/vocab/vocabStore";
import { mergeCards, normalizeCard, definitionForContext, activeSentence } from "../lib/vocab/book";

const first = "The bank approved the loan.";
const second = "The bank beside the river was quiet.";
const entry = { word: "bank", def: "n. 银行；河岸", defFull: "n. 银行；河岸", sentence: first };
const time = date => new Date(`2026-10-${date}T10:00:00Z`);
beforeEach(() => localStorage.clear());

test("新词采用保留词典备份、锁定释义及精确句义，裸词首选但其他句不误用", () => {
  const card = adoptContextSense(entry, "此处指河岸", second, time("02"), getVocabAccountKey());
  expect(card).toMatchObject({ def: "此处指河岸", definitionLocked: true, baseDef: entry.def, defFull: entry.defFull, reps: 0 });
  expect(definitionForContext(card, second)).toBe("此处指河岸");
  expect(definitionForContext(card, second + " Other words.")).toBe(entry.def);
  expect(definitionForContext(card, "")).toBe("此处指河岸");
  expect(definitionForContext({ ...card, baseDef: "", defFull: "" }, first)).toBe("");
});

test("已收藏词采用保留阅读与听力进度，提升主句、容量剪枝且不生成第二张卡", () => {
  const old = normalizeCard({ ...entry, state: "review", reps: 12, stability: 22, readingUpdatedAt: time("01").toISOString(), listeningState: { state: "review", reps: 7, stability: 9, updatedAt: time("01").toISOString() }, sentences: ["A bank in town.", "The bank is old.", "The bank is open."] }, time("01"));
  writeBook([old]);
  const card = adoptContextSense(entry, "河岸", second, time("02"));
  expect(card.reps).toBe(12);
  expect(card.stability).toBe(22);
  expect(card.readingUpdatedAt).toBe(old.readingUpdatedAt);
  expect(card.listeningState).toEqual(old.listeningState);
  expect(card.sentence).toBe(second);
  expect(card.sentences).toEqual([first, "The bank is old.", "The bank is open."]);
  expect(card.contextSenses.map(s => s.sentence)).toEqual([second]);
});

test("句子轮换采用对应义，不让第二句使用第一句特殊义", () => {
  saveWord(entry, time("01"));
  adoptContextSense(entry, "银行", first, time("02"));
  const card = adoptContextSense(entry, "河岸", second, time("03"));
  expect(definitionForContext({ ...card, reps: 0 }, activeSentence({ ...card, reps: 0 }))).toBe("河岸");
  expect(definitionForContext({ ...card, reps: 1 }, activeSentence({ ...card, reps: 1 }))).toBe("银行");
});

test("词典反选当前句覆盖AI义，全局反选水位阻止同步复活旧AI义", () => {
  const ai = adoptContextSense(entry, "河岸", second, time("02"));
  const selected = chooseSense("bank", "n. 岸", entry.defFull, time("03"), second);
  expect(definitionForContext(selected, second)).toBe("n. 岸");
  const global = chooseSense("bank", "n. 银行", entry.defFull, time("04"));
  const merged = mergeCards([global], [ai])[0];
  expect(merged.contextSenses).toEqual([]);
  expect(definitionForContext(merged, second)).toBe("n. 银行");
});

test("更晚复习评分和旧客户端shape不能盖掉明确采用，新句义按每句时间合并", () => {
  const ai = adoptContextSense(entry, "河岸", second, time("02"));
  const legacy = normalizeCard({ ...entry, definitionLocked: true, updatedAt: time("09").toISOString(), readingUpdatedAt: time("09").toISOString(), reps: 20 }, time("01"));
  const merged = mergeCards([ai], [legacy])[0];
  expect(merged.def).toBe("河岸");
  expect(merged.baseDef).toBe(entry.def);
  expect(merged.reps).toBe(20);
  expect(merged.sentence).toBe(second);
  expect(mergeCards([legacy], [ai])[0].def).toBe("河岸");
  const other = { ...ai, updatedAt: time("03").toISOString(), contextSenses: [{ sentence: second, def: "n. 岸", updatedAt: time("03").toISOString() }] };
  expect(mergeCards([ai], [other])[0].contextSenses[0].def).toBe("n. 岸");
});

test("账户切换、非法值、过长或8KB失败都不部分写入", () => {
  saveWord(entry, time("01"));
  const before = getCard("bank");
  expect(adoptContextSense(entry, "河岸", second, time("02"), "OTHER")).toBeNull();
  for (const [def, sentence] of [["…", second], ["义".repeat(301), second], ["河岸", "a".repeat(401)]]) {
    expect(() => adoptContextSense(entry, def, sentence, time("02"))).toThrow();
    expect(getCard("bank")).toEqual(before);
  }
  expect(() => adoptContextSense({ ...entry, word: "newword", defFull: "义".repeat(4000) }, "河岸", second, time("02"))).toThrow(/8 KB/);
  expect(getCard("newword")).toBeNull();
});

test("空通用义不会让绑定特殊义泄漏给另一句，normalize只保留池内有效义", () => {
  const card = normalizeCard({ word: "bank", def: "河岸", contextSenses: [{ sentence: second, def: "河岸", updatedAt: time("02").toISOString() }, { sentence: first, def: "银行", updatedAt: time("02").toISOString() }], sentence: second });
  expect(card.contextSenses).toHaveLength(1);
  expect(definitionForContext(card, first)).toBe("");
});


test("另一句点词典义项只修改当前句并提升主句，不抹掉原AI义", () => {
  adoptContextSense(entry, "河岸", second, time("02"));
  const card = chooseSense("bank", "n. 银行", entry.defFull, time("03"), first);
  expect(card.sentence).toBe(first);
  expect(card.def).toBe("n. 银行");
  expect(definitionForContext(card, second)).toBe("河岸");
  expect(definitionForContext(card, first)).toBe("n. 银行");
  const again = chooseSense("bank", "n. 岸", entry.defFull, time("04"), second);
  expect(again.sentence).toBe(second);
  expect(definitionForContext(again, first)).toBe("n. 银行");
});

test("采用新听力原句更新音频与当前模式，保留两条SRS；阅读采用不抹听力原句", () => {
  const oldContext = { audioUrl: "/api/audio/old.mp3", start: 0, end: 3, text: first };
  const nextContext = { audioUrl: "/api/audio/new.mp3", start: 2, end: 5, text: second };
  writeBook([normalizeCard({ ...entry, reps: 8, listeningState: { reps: 4 }, listeningContext: oldContext })]);
  const card = adoptContextSense({ ...entry, reviewMode: "listening", listeningContext: nextContext }, "河岸", second, time("02"));
  expect(card.listeningContext).toEqual(nextContext);
  expect(card.reviewMode).toBe("listening");
  expect(card.reps).toBe(8);
  expect(card.listeningState.reps).toBe(4);
  const reading = adoptContextSense({ ...entry, reviewMode: "reading" }, "银行", first, time("03"));
  expect(reading.listeningContext).toEqual(nextContext);
  expect(reading.listeningState).toEqual(card.listeningState);
  expect(reading.reps).toBe(8);
});
