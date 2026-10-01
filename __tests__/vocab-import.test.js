const { TextEncoder, TextDecoder } = require("util");
global.TextEncoder = TextEncoder; global.TextDecoder = TextDecoder;
import { parseVocabularyText, parseVocabularyRows, normalizeVocabularyItems, enrichVocabularyItems } from "../lib/vocab/importVocabulary";
import { reconstructPdfVocabularyText, readVocabularyFile } from "../lib/vocab/readVocabularyFile";
jest.mock("../lib/dict/lookup", () => ({ lookupWord: jest.fn() }));
const words = (result) => result.items.map((item) => item.word);
test("numbered bilingual phrases, apostrophes, hyphens and duplicate definitions", () => {
  const result = parseVocabularyText("1. Abandon /əˈbændən/ v. 放弃\n2) in spite of 尽管\n3. mother-in-law 岳母\n4. don't 不要\n5. ABANDON 抛弃");
  expect(words(result)).toEqual(["abandon", "in spite of", "mother-in-law", "don't"]);
  expect(result.items[0]).toMatchObject({ phonetic: "əˈbændən", def: "v. 放弃", display: "Abandon" });
  expect(result.duplicates).toBe(1);
});
test("quoted CSV columns preserve commas, embedded newlines and escaped quotes", () => {
  const result = parseVocabularyText('meaning,word,example,phonetic\n"n. 选择,决定",choice,"A \\"choice\\".\nSecond line.",/tʃɔɪs/'.replace(/\\"/g, '""'));
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({ word: "choice", def: "n. 选择,决定", phonetic: "tʃɔɪs", sentence: 'A "choice".\nSecond line.' });
});
test("bare whitespace and comma lists and Chinese CSV retain all words", () => {
  expect(parseVocabularyText("apple banana cherry").items[0]).toMatchObject({ word: "apple banana cherry", uncertain: true });
  expect(words(parseVocabularyText("apple, banana, cherry"))).toEqual(["apple", "banana", "cherry"]);
  expect(words(parseVocabularyText("apple,苹果\nbanana,香蕉"))).toEqual(["apple", "banana"]);
});
test("prose, numbers, long words, headings and exported branding are skipped", () => {
  expect(parseVocabularyText("I am excited").items).toEqual([]);
  const result = parseVocabularyText("TREEPRACTICE VOCABULARY\nTreePractice\n第 1 页\n1 / 2\nword | meaning\napple 苹果\nI am excited.\nThis paragraph contains more than five separate words");
  expect(words(result)).toEqual(["apple"]);
  expect(result.skipped).toBeGreaterThan(0);
  expect(normalizeVocabularyItems([{ word: "a".repeat(81) }, { word: "a b c d e f" }, { word: "abc123" }, null]).skipped).toBe(4);
});
test("blank and repeated headers don't become words", () => {
  expect(words(parseVocabularyRows([[""], ["word", "meaning"], ["apple", "苹果"], ["word", "meaning"], ["banana", "香蕉"]]))).toEqual(["apple", "banana"]);
});
test("header-like vocabulary words retain their definitions in header and no-header tables", () => {
  const entries = [["word", "单词"], ["vocabulary", "词汇"], ["term", "术语"], ["english", "英语"], ["apple", "苹果"]];
  for (const rows of [entries, [["word", "meaning"], ...entries]]) {
    const result = parseVocabularyRows(rows);
    expect(words(result)).toEqual(["word", "vocabulary", "term", "english", "apple"]);
    expect(result.items.map((item) => item.def)).toEqual(["单词", "词汇", "术语", "英语", "苹果"]);
  }
});
test("reordered multi-field headers and repeated numbered headers are detected by row structure", () => {
  const result = parseVocabularyRows([["编号", "释义", "单词", "音标"], ["1", "词汇", "vocabulary", "vəˈkæbjələri"], ["编号", "释义", "单词", "音标"], ["2", "术语", "term", "tɜːm"]]);
  expect(words(result)).toEqual(["vocabulary", "term"]);
  expect(result.items[0]).toMatchObject({ def: "词汇", phonetic: "vəˈkæbjələri" });
});
test("known word and definition headers may include unfamiliar extra columns", () => {
  for (const rows of [
    [["word", "meaning", "notes"], ["apple", "苹果", "fruit"], ["word", "meaning", "notes"], ["term", "术语", "review"]],
    [["单词", "释义", "词性"], ["apple", "苹果", "n."], ["term", "术语", "n."]],
  ]) {
    const result = parseVocabularyRows(rows);
    expect(words(result)).toEqual(["apple", "term"]);
    expect(result.items.map((item) => item.def)).toEqual(["苹果", "术语"]);
  }
});
test("oversized fields remain editable in preview with actionable warnings rather than being truncated", () => {
  const result = normalizeVocabularyItems([{ word: "a".repeat(61), def: "义".repeat(3001), sentence: "s".repeat(401), phonetic: "p".repeat(161) }]);
  expect(result.items[0]).toMatchObject({ word: "a".repeat(61), def: "义".repeat(3001), sentence: "s".repeat(401), phonetic: "p".repeat(161) });
  expect(result.items[0].validationError).toContain("60");
  expect(result.warnings.join()).toContain("请缩短");
});
test("a phrase never inherits its last word definition and inflections don't inherit lemma phonetics", async () => {
  const { lookupWord } = require("../lib/dict/lookup");
  lookupWord.mockImplementation(async (word) => word === "in spite of" ? { word: "of", queried: "of", t: "属于", p: "əv" } : { word: "study", queried: "study", t: "n. 学习", p: "stʌdi" });
  const entries = [{ word: "in spite of", def: "", phonetic: "" }, { word: "studies", def: "", phonetic: "" }, { word: "study", def: "自己的解释", phonetic: "自己的音标" }];
  const result = await enrichVocabularyItems(entries);
  expect(result[0].def).toBe("");
  expect(result[1]).toMatchObject({ word: "studies", def: "n. 学习", phonetic: "" });
  expect(result[2]).toMatchObject({ def: "自己的解释", phonetic: "自己的音标" });
});
const token = (str, x, y, width = str.length * 6) => ({ str, transform: [1, 0, 0, 1, x, y], width });
test("coordinate PDF text retains multi column rows", () => {
  const extracted = reconstructPdfVocabularyText([token("apple", 20, 600), token("苹果", 100, 600, 20), token("banana", 330, 600), token("香蕉", 410, 600, 20)], 600);
  expect(words(parseVocabularyText(extracted))).toEqual(["apple", "banana"]);
});
test("printable notebook PDF preserves stacked IPA, wrapped meaning and original sentence", () => {
  const content = [token("TreePractice", 40, 780), token("自测", 40, 720), token("单词 · 音标", 75, 720), token("中文释义", 285, 720),
    token("abandon", 75, 700), token("v. 放弃", 285, 700), token("/əˈbændən/", 75, 685), token("停止支持某个计划", 285, 685),
    token("原句  We abandon the plan.", 75, 666), token("banana", 75, 620), token("n. 香蕉", 285, 620), token("/bəˈnænə/", 75, 605), token("TreePractice / 单词复习", 40, 30), token("1 / 1", 540, 30)];
  const result = parseVocabularyText(reconstructPdfVocabularyText(content));
  expect(words(result)).toEqual(["abandon", "banana"]);
  expect(result.items[0]).toMatchObject({ phonetic: "əˈbændən", def: "v. 放弃 停止支持某个计划", sentence: "We abandon the plan." });
});
test("CSV file extension explicitly parses Chinese no-header rows", async () => {
  const value = new TextEncoder().encode("apple,苹果\nbanana,香蕉");
  const result = await readVocabularyFile({ name: "words.csv", size: value.byteLength, arrayBuffer: async () => value.buffer });
  expect(words(result)).toEqual(["apple", "banana"]);
});

test("common English loanwords preserve Latin accents", () => { expect(words(parseVocabularyText("café 咖啡馆\nrésumé 简历\nnaïve 天真的"))).toEqual(["café", "résumé", "naïve"]); });

test("real printable PDF text roundtrips all seven words and wrapped fields", () => {
  const pages = require("./fixtures/vocab-template-text.json");
  const result = parseVocabularyText(reconstructPdfVocabularyText(pages[0].items, pages[0].width));
  expect(words(result)).toEqual(["sustainability", "resilient", "phenomenon", "coherent", "interdisciplinary", "pneumonoultramicroscopicsilicovolcanoconiosis", "café"]);
  expect(result.items[4].def).toContain("城市规划");
  expect(result.items[4].sentence).toContain("neighbourhoods meaningful.");
  expect(result.items[5].phonetic).toBe("ˌnjuːmənoʊˌʌltrəmaɪkrəˌskɒpɪkˌsɪlɪkoʊvɒlˌkeɪnoʊˈkoʊniəsɪs");
  expect(result.items[5].def).toContain("音标换行的样例");
  expect(result.items[6].phonetic).toBe("ˈkæfeɪ");
});

test("numeric table index column is not treated as the word", () => {
  const result = parseVocabularyRows([[1, "apple", "苹果"], [2, "banana", "香蕉"]]);
  expect(words(result)).toEqual(["apple", "banana"]);
});
test("UTF16 and Windows GBK preserve Chinese definitions with encoding notice", async () => {
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("word,meaning\napple,苹果", "utf16le")]);
  const utf16 = await readVocabularyFile({ name: "words.csv", size: le.byteLength, arrayBuffer: async () => le.buffer.slice(le.byteOffset, le.byteOffset + le.byteLength) });
  expect(utf16.items[0].def).toBe("苹果"); expect(utf16.warnings.join()).toContain("UTF-16");
  const gbk = Buffer.from([0x61,0x70,0x70,0x6c,0x65,0x2c,0xc6,0xbb,0xb9,0xfb]);
  const legacy = await readVocabularyFile({ name: "words.csv", size: gbk.byteLength, arrayBuffer: async () => gbk.buffer.slice(gbk.byteOffset, gbk.byteOffset + gbk.byteLength) });
  expect(legacy.items[0].def).toBe("苹果"); expect(legacy.warnings.join()).toContain("GBK");
});

test("free English sentence rows are uncertain instead of becoming default word candidates", () => {
  const result = parseVocabularyText("Birds migrate\nClimate changes rapidly");
  expect(result.items.every((item) => item.uncertain)).toBe(true);
  expect(result.warnings.join()).toContain("默认不选");
  expect(parseVocabularyRows([["resilient 有韧性的"]]).items[0]).toMatchObject({ word: "resilient", def: "有韧性的" });
});
