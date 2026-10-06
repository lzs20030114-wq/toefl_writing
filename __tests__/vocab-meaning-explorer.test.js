import { normalizeMeaningQuery, buildMeaningPrompts, parseMeaningResult, meaningWordEntry, cacheMeaningResult, readMeaningCached, readMeaningHistory, meaningHistoryKey } from "../lib/vocab/meaningExplorer";
import { normalizeCard, clozeSentence } from "../lib/vocab/book";
import { validateVocabularyEntry } from "../lib/vocab/importVocabulary";

const item = (word = "hinder") => ({ word, partOfSpeech: "v.", meaning: "妨碍", usage: "用于进展受阻的场景", difference: "强调减慢进展，不一定完全阻止", collocations: ["hinder progress"], example: `These rules ${word} progress.`, translation: "这些规则妨碍进展。" });
const data = () => ({ summary: "这些表达强调不同的妨碍方式", memoryTip: "按阻碍程度和对象记忆", words: [item(), item("get in the way")] });
beforeEach(() => { localStorage.clear(); });

test("中文查询规范化，拒绝纯英文、控制符、指令分隔符和过长输入", () => {
  expect(normalizeMeaningQuery("  妨碍  进展 ")).toBe("妨碍 进展");
  expect(normalizeMeaningQuery("妨碍（进展）")).toBe("妨碍（进展）");
  for (const value of ["hinder", "妨碍\n", "妨碍<script>", "中".repeat(31), {}, ""]) expect(normalizeMeaningQuery(value)).toBe("");
  expect(buildMeaningPrompts("妨碍").system).toContain("不声称穷尽");
  expect(buildMeaningPrompts("妨碍").system).toContain("不强凑数");
  expect(buildMeaningPrompts("妨碍").system).toContain("只有明确的语法限制");
});

test("接受 JSON 代码块、短语并去重，最多8个有效词", () => {
  const input = data();
  input.words.push(item("HINDER"));
  const result = parseMeaningResult(`\`\`\`json\n${JSON.stringify(input)}\n\`\`\``, "妨碍");
  expect(result.words.map(word => word.word)).toEqual(["hinder", "get in the way"]);
  input.words = ["hinder", "impede", "obstruct", "block", "hamper", "inhibit", "prevent", "disrupt", "interrupt"].map(word => item(word));
  expect(parseMeaningResult(input, "妨碍").words).toHaveLength(8);
});

test("非法字段或缺失目标词的例句不会被截断修成合法词条", () => {
  for (const invalid of [{ word: "x".repeat(61) }, { word: "hinder/impede" }, { example: "This hinders progress." }, { example: "This unhindered progress." }, { meaning: {} }, { difference: "中".repeat(161) }, { collocations: "hinder progress" }, { collocations: ["妨碍进展"] }, { translation: "English only" }, { example: "中 hinder" }]) {
    const input = data();
    input.words[0] = { ...input.words[0], ...invalid };
    expect(() => parseMeaningResult(input, "妨碍")).toThrow("足够");
  }
  expect(() => parseMeaningResult("oops", "妨碍")).toThrow("格式");
  expect(() => parseMeaningResult({ ...data(), summary: 12 }, "妨碍")).toThrow("格式");
});

test("词条兼容入库并保留辨析、例句和短语挖空", () => {
  const result = parseMeaningResult(data(), "妨碍");
  for (const word of result.words) {
    const entry = meaningWordEntry(word, "妨碍", "listening");
    expect(validateVocabularyEntry(entry)).toBe("");
    expect(entry.def.length).toBeLessThanOrEqual(300);
    expect(entry.def).toContain(word.difference);
    expect(entry.sentence).toBe(word.example);
    expect(entry.reviewMode).toBe("listening");
    expect(normalizeCard(entry).definitionLocked).toBe(true);
    expect(clozeSentence(normalizeCard(entry))).toContain("_");
    expect(clozeSentence(normalizeCard(entry))).not.toContain(word.word);
  }
});

test("缓存账户隔离、过期过滤、损坏安全并返回经过验证的结果", () => {
  const result = parseMeaningResult(data(), "妨碍");
  expect(cacheMeaningResult("alice", result)).toBe(true);
  expect(readMeaningCached(" 妨碍 ", "alice")).toEqual(result);
  expect(readMeaningCached("妨碍", "bob")).toBeNull();
  const stored = JSON.parse(localStorage.getItem(meaningHistoryKey("alice")));
  stored[0].at = new Date(Date.now() - 31 * 86400000).toISOString();
  localStorage.setItem(meaningHistoryKey("alice"), JSON.stringify(stored));
  expect(readMeaningHistory("alice")).toEqual([]);
  localStorage.setItem(meaningHistoryKey("alice"), "bad json");
  expect(readMeaningHistory("alice")).toEqual([]);
  expect(cacheMeaningResult("alice", { ...result, words: [] })).toBe(false);
  const spy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  expect(cacheMeaningResult("alice", result)).toBe(false);
  spy.mockRestore();
});

test("缓存只保留最近12条，重查更新顺序，损坏词条不显示", () => {
  const result = parseMeaningResult(data(), "妨碍");
  for (let i = 0; i < 15; i++) expect(cacheMeaningResult("alice", { ...result, query: `妨碍${i}` })).toBe(true);
  expect(readMeaningHistory("alice")).toHaveLength(12);
  expect(cacheMeaningResult("alice", { ...result, query: "妨碍4" })).toBe(true);
  expect(readMeaningHistory("alice")[0].result.query).toBe("妨碍4");
  localStorage.setItem(meaningHistoryKey("alice"), JSON.stringify([{ at: new Date().toISOString(), result: { ...result, words: [] } }]));
  expect(readMeaningHistory("alice")).toEqual([]);
});
