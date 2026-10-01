let store;
beforeEach(() => { jest.useFakeTimers(); localStorage.clear(); jest.resetModules(); store = require("../lib/vocab/vocabStore"); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });
test("batch import preserves exact active progress and definitions with one write/event", () => {
  localStorage.setItem("toefl-user-code", "AAAAAA");
  store.saveWord({ word: "apple", def: "原释义" }, new Date("2026-09-20"));
  store.gradeCard("apple", 3, new Date("2026-09-21"));
  const previous = store.getCard("apple");
  const writes = jest.spyOn(Storage.prototype, "setItem"), dispatch = jest.spyOn(window, "dispatchEvent");
  const result = store.importWords([{ word: "APPLE", def: "覆盖释义" }, { word: "banana", def: "香蕉" }, { word: "BANANA" }, { word: "123" }], { expectedAccount: "AAAAAA", now: new Date("2026-10-01") });
  expect(result).toEqual({ added: 1, duplicates: 2, invalid: 1, persisted: true, accountChanged: false });
  expect(store.getCard("apple")).toEqual(previous);
  expect(writes).toHaveBeenCalledTimes(1); expect(dispatch).toHaveBeenCalledTimes(1);
});
test("a deleted card is revived as a fresh card", () => {
  store.saveWord({ word: "apple", def: "旧义" }); store.gradeCard("apple", 3); store.removeWord("apple");
  const result = store.importWords([{ word: "apple", def: "新义" }], { now: new Date("2026-10-01"), reviewMode: "listening" });
  expect(result.added).toBe(1);
  expect(store.getCard("apple")).toMatchObject({ def: "新义", reps: 0, deletedAt: null, reviewMode: "listening", introducedAt: null, listeningState: { reps: 0 } });
});
test("account changed during preview produces no writes", () => {
  localStorage.setItem("toefl-user-code", "BBBBBB"); const writes = jest.spyOn(Storage.prototype, "setItem");
  expect(store.importWords([{ word: "apple" }], { expectedAccount: "AAAAAA" }).accountChanged).toBe(true);
  expect(writes).not.toHaveBeenCalled(); expect(store.loadBook()).toEqual([]);
});
test.each([
  [{ word: "a".repeat(61) }, "60"],
  [{ word: "oversized", def: "义".repeat(3000) }, "8 KB"],
  [{ word: "oversized", def: "d".repeat(3001) }, "3000"],
  [{ word: "oversized", sentence: "s".repeat(401) }, "400"],
  [{ word: "oversized", phonetic: "p".repeat(161) }, "160"],
])("an invalid final card rejects the entire batch before writing: %p", (entry, limit) => {
  const writes = jest.spyOn(Storage.prototype, "setItem"), dispatch = jest.spyOn(window, "dispatchEvent");
  expect(() => store.importWords([{ word: "apple", def: "苹果" }, entry])).toThrow(limit);
  expect(writes).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled();
  expect(store.loadBook()).toEqual([]); expect(jest.getTimerCount()).toBe(0);
});
test("dictionary enrichment is checked again before any word is imported", async () => {
  jest.doMock("../lib/dict/lookup", () => ({ lookupWord: jest.fn(async () => ({ word: "banana", queried: "banana", t: "义".repeat(3000), p: "bənɑːnə" })) }));
  const { enrichVocabularyItems } = require("../lib/vocab/importVocabulary");
  const enriched = await enrichVocabularyItems([{ word: "banana", def: "", phonetic: "" }]);
  const writes = jest.spyOn(Storage.prototype, "setItem");
  expect(() => store.importWords(enriched)).toThrow("8 KB");
  expect(writes).not.toHaveBeenCalled(); expect(store.loadBook()).toEqual([]);
  jest.dontMock("../lib/dict/lookup");
});
test("the complete normalized card fits the existing cloud contract at its byte boundary", () => {
  const { vocabularyCardBytes, VOCAB_CARD_MAX_BYTES } = require("../lib/vocab/syncLimits");
  const fixedNow = new Date("2026-10-01");
  store.importWords([{ word: "boundary", def: "义" }], { now: fixedNow, reviewMode: "listening" });
  const base = store.getCard("boundary");
  const remainder = VOCAB_CARD_MAX_BYTES - vocabularyCardBytes(base);
  const count = Math.floor(remainder / 3), extra = remainder % 3;
  const def = "义".repeat(1 + count) + "a".repeat(extra);
  localStorage.clear();
  store.importWords([{ word: "boundary", def }], { now: fixedNow, reviewMode: "listening" });
  const saved = store.getCard("boundary");
  expect(vocabularyCardBytes(saved)).toBe(VOCAB_CARD_MAX_BYTES);
  expect(vocabularyCardBytes(saved)).toBe(Buffer.byteLength(JSON.stringify(saved), "utf8"));
  expect(saved).not.toHaveProperty("validationError");
  localStorage.clear();
  expect(() => store.importWords([{ word: "boundary", def: def + "a" }], { now: fixedNow, reviewMode: "listening" })).toThrow("8 KB");
  expect(store.loadBook()).toEqual([]);
});
test("quota failures truthfully report unsaved status but keep the complete in-memory book", () => {
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  expect(store.importWords([{ word: "apple" }, { word: "banana" }]).persisted).toBe(false);
  expect(store.loadBook().map((c) => c.word).sort()).toEqual(["apple", "banana"]);
  expect(store.getVocabStorageStatus().persisted).toBe(false);
});

test("imported user definitions remain locked across auto dictionary fill and synchronization", () => {
  const { normalizeCard, mergeCards, needsDictFill, CARD_FIELDS } = require("../lib/vocab/book");
  store.importWords([{ word: "apple", def: "苹果" }], { now: new Date("2026-10-01") });
  expect(store.getCard("apple").definitionLocked).toBe(true);
  store.adoptDictEntry("apple", { word: "apple", t: "n. 苹果；苹果树；苹果公司" });
  const saved = store.getCard("apple"); expect(saved.def).toBe("苹果"); expect(needsDictFill(saved)).toBe(false);
  expect(normalizeCard(JSON.parse(JSON.stringify(saved))).definitionLocked).toBe(true);
  expect(CARD_FIELDS).toContain("definitionLocked");
  const merged = mergeCards([saved], [{ ...saved, definitionLocked: false, def: "n. 苹果；苹果树", updatedAt: "2026-10-02T00:00:00Z", reps: 3 }])[0];
  expect(merged).toMatchObject({ definitionLocked: true, def: "苹果", reps: 3 });
  store.importWords([{ word: "banana" }]); expect(needsDictFill(store.getCard("banana"))).toBe(true);
});
