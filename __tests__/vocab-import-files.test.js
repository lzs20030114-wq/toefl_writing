const { TextEncoder, TextDecoder } = require("util");
global.TextEncoder = TextEncoder; global.TextDecoder = TextDecoder;
const fs = require("fs");
const { zipSync, strToU8 } = require("fflate");
const mockReadXlsx = jest.fn();
let mockPages = [];
const mockDestroy = jest.fn();
const OPS = { save: 1, restore: 2, transform: 3, paintImageXObject: 4, paintInlineImageXObject: 5, paintImageMaskXObject: 6 };
jest.mock("read-excel-file/browser", () => ({ __esModule: true, default: (...args) => mockReadXlsx(...args) }));
jest.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, OPS: { save: 1, restore: 2, transform: 3, paintImageXObject: 4, paintInlineImageXObject: 5, paintImageMaskXObject: 6 }, getDocument: () => ({ promise: Promise.resolve({ numPages: mockPages.length, getPage: async (i) => mockPages[i - 1], destroy: mockDestroy }), destroy: mockDestroy }) }));
const { readVocabularyFile, hasLargePdfRaster, reconstructPdfVocabularyText } = require("../lib/vocab/readVocabularyFile");
const { parseVocabularyText } = require("../lib/vocab/importVocabulary");
const file = (name, bytes) => ({ name, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
const token = (str, x = 20, y = 700) => ({ str, transform: [1, 0, 0, 1, x, y], width: str.length * 5 });
function page(items, raster = false) { return { getTextContent: async () => ({ items }), getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }), getOperatorList: async () => raster ? { fnArray: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore], argsArray: [[], [580,0,0,700,10,10], ["image"], []] } : { fnArray: [], argsArray: [] }, render: jest.fn(() => ({ promise: Promise.resolve() })), cleanup: jest.fn() }; }
beforeEach(() => {
  jest.clearAllMocks(); mockPages = [];
  jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({});
  jest.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (callback) { callback(new Blob(["test"], { type: "image/jpeg" })); });
});
afterEach(() => { jest.restoreAllMocks(); });
test("all Excel sheets feed the same preview, not only the first one", async () => {
  mockReadXlsx.mockResolvedValue([{ sheet: "First", data: [["编号", "word", "meaning"], [1, "apple", "苹果"]] }, { sheet: "Second", data: [["word", "meaning"], ["banana", "香蕉"]] }]);
  const result = await readVocabularyFile(file("words.xlsx", fs.readFileSync("__tests__/fixtures/vocab-two-sheets.xlsx")));
  expect(result.items.map((item) => item.word)).toEqual(["apple", "banana"]); expect(mockReadXlsx).toHaveBeenCalledTimes(1);
});
test("DOCX parses separate table schemas and includes plain paragraphs once", async () => {
  const result = await readVocabularyFile(file("words.docx", fs.readFileSync("__tests__/fixtures/vocab-two-tables.docx")));
  expect(result.items.map((item) => item.word)).toEqual(["apple", "banana", "café"]);
  expect(result.items.map((item) => item.def)).toEqual(["苹果", "香蕉", "咖啡馆"]);
});
test("DOCX preserves Shift+Enter vocabulary rows and tabs without splitting table columns", async () => {
  const run = (value) => `<w:r><w:t>${value}</w:t></w:r>`;
  const paragraph = (value) => `<w:p>${value}</w:p>`;
  const cell = (value) => `<w:tc>${value}</w:tc>`;
  const row = (values) => `<w:tr>${values.map((value) => cell(paragraph(run(value)))).join("")}</w:tr>`;
  const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    ${paragraph(`${run("apple")}<w:r><w:tab/></w:r>${run("苹果")}<w:r><w:br/></w:r>${run("banana")}<w:r><w:tab/></w:r>${run("香蕉")}`)}
    <w:tbl>${row(["word", "meaning", "example"])}<w:tr>${cell(paragraph(run("cherry")))}${cell(paragraph(`${run("樱桃")}<w:r><w:br/></w:r>${run("一种水果")}`))}${cell(paragraph(`${run("Keep")}<w:r><w:tab/></w:r>${run("the tab.")}`) + paragraph(run("Keep the next paragraph.")))}</w:tr></w:tbl>
    </w:body></w:document>`;
  const result = await readVocabularyFile(file("breaks.docx", zipSync({ "word/document.xml": strToU8(xml) })));
  expect(result.items.map((item) => item.word).sort()).toEqual(["apple", "banana", "cherry"]);
  expect(result.items.find((item) => item.word === "apple").def).toBe("苹果");
  expect(result.items.find((item) => item.word === "banana").def).toBe("香蕉");
  expect(result.items.find((item) => item.word === "cherry")).toMatchObject({ def: "樱桃\n一种水果", sentence: "Keep\tthe tab.\nKeep the next paragraph." });
});
// Coordinates below were extracted by pdfjs from the actual createVocabularyPdf
// output and bundled fonts, including its explicit continuation markers.
const pagination = require("./fixtures/vocab-pagination-text.json");
test.each(["definition", "sentence", "normal", "word"])("real exported PDF preserves complete %s across page boundaries", async (name) => {
  const { cards, pages } = pagination[name];
  mockPages = pages.map((value) => page(value.items));
  const result = await readVocabularyFile(file(`${name}.pdf`, new Uint8Array([1])));
  expect(result.items.map((item) => item.word)).toEqual(cards.map((card) => card.word));
  for (const card of cards) {
    const actual = result.items.find((item) => item.word === card.word);
    expect(actual.phonetic).toBe(card.phonetic || "");
    expect(actual.def.replace(/\s/g, "")).toBe(card.def.replace(/\s/g, ""));
    expect(actual.sentence.replace(/\s+/g, " ").trim()).toBe((card.sentence || "").replace(/\s+/g, " ").trim());
  }
  expect(result.duplicates).toBe(0);
  if (name !== "sentence") expect(result.warnings).toEqual([]);
});
test("PDF continuation can complete a wrapped word and IPA while the public single-page helper stays a string", async () => {
  const header = [token("单词 · 音标", 75, 720), token("中文释义", 285, 720)];
  mockPages = [page([...header, token("pneumonoultramicro", 75, 700), token("释义", 285, 700)]),
    page([...header, token("续", 45, 700), token("scopicsilicovolcanoconiosis", 75, 700), token("/ˌnjuːmənoʊ", 75, 684)]),
    page([...header, token("续", 45, 700), token("ˈkoʊniəsɪs/", 75, 700), token("banana", 75, 640), token("香蕉", 285, 640)])];
  const result = await readVocabularyFile(file("wrapped.pdf", new Uint8Array([1])));
  expect(result.items.map((item) => item.word)).toEqual(["pneumonoultramicroscopicsilicovolcanoconiosis", "banana"]);
  expect(result.items[0]).toMatchObject({ phonetic: "ˌnjuːmənoʊˈkoʊniəsɪs", def: "释义" });
  const text = reconstructPdfVocabularyText([...header, token("apple", 75, 700), token("苹果", 285, 700)]);
  expect(typeof text).toBe("string"); expect(parseVocabularyText(text).items[0].word).toBe("apple");
});
test("mixing notebook and external PDF pages keeps document order and never joins unmarked pages", async () => {
  const header = [token("单词 · 音标", 75, 720), token("中文释义", 285, 720)];
  mockPages = [page([...header, token("apple", 75, 700), token("苹果", 285, 700)]),
    page([token("banana 香蕉")]), page([...header, token("cherry", 75, 700), token("樱桃", 285, 700)])];
  const result = await readVocabularyFile(file("mixed-layout.pdf", new Uint8Array([1])));
  expect(result.items.map((item) => item.word)).toEqual(["apple", "banana", "cherry"]);
  expect(result.items.map((item) => item.def)).toEqual(["苹果", "香蕉", "樱桃"]);
});
test("oversized decompressed document and huge sheet ranges fail before general readers", async () => {
  const bomb = zipSync({ "word/document.xml": new Uint8Array(26 * 1024 * 1024) });
  await expect(readVocabularyFile(file("bomb.docx", bomb))).rejects.toThrow("25 MB");
  const huge = zipSync({ "xl/worksheets/sheet1.xml": strToU8('<worksheet><dimension ref="A1:ZZ10001"/></worksheet>') });
  await expect(readVocabularyFile(file("huge.xlsx", huge))).rejects.toThrow("范围过大"); expect(mockReadXlsx).not.toHaveBeenCalled();
});
test("selectable title over full-page scan returns an image rather than a fake vocabulary entry", async () => {
  mockPages = [page([token("VOCABULARY LIST - UNIT 3")], true)];
  const result = await readVocabularyFile(file("scan.pdf", new Uint8Array([1])));
  expect(result.items).toEqual([]); expect(result.images).toHaveLength(1); expect(mockPages[0].render).toHaveBeenCalled(); expect(mockDestroy).toHaveBeenCalled();
});
test("mixed text/scanned PDF preserves text candidates and pending images", async () => {
  mockPages = [page([token("apple 苹果"), token("banana 香蕉", 20, 670)]), page([], true)];
  const result = await readVocabularyFile(file("mixed.pdf", new Uint8Array([1])));
  expect(result.items.map((item) => item.word)).toEqual(["apple", "banana"]); expect(result.images).toHaveLength(1);
});
test("more than three scan pages or thirty total pages reports a split-file error without partial result", async () => {
  mockPages = Array.from({ length: 4 }, () => page([], true));
  await expect(readVocabularyFile(file("scan.pdf", new Uint8Array([1])))).rejects.toThrow("超过 3 页");
  mockPages = Array.from({ length: 31 }, () => page([]));
  await expect(readVocabularyFile(file("text.pdf", new Uint8Array([1])))).rejects.toThrow("超过 30 页");
});
test("small logos do not turn an otherwise sparse text page into a scan", () => {
  expect(hasLargePdfRaster({ fnArray: [OPS.transform, OPS.paintImageXObject], argsArray: [[40,0,0,40,0,0], []] }, OPS, 600, 800)).toBe(false);
});
