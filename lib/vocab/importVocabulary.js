/** Deterministic vocabulary import. This module is also used by the server validator. */
import { VOCAB_WORD_MAX_LENGTH } from "./syncLimits";
const text = (value) => typeof value === "string" ? value.trim() : "";
const HEADERS = {
  word: /^(word|words|vocabulary|term|english|单词(?:\s*·\s*音标)?|词汇|英文|词语)$/i,
  def: /^(def|definition|meaning|translation|释义|中文释义|中文|含义|解释)$/i,
  phonetic: /^(phonetic|pronunciation|ipa|音标)$/i,
  sentence: /^(sentence|example|context|例句|原句|语境)$/i,
  source: /^(source|来源)$/i,
};
export const cleanPhonetic = (value) => text(value).replace(/^(?:\/(.*)\/|\[(.*)\])$/, (_, a, b) => a || b || "");
const IMPORT_FIELD_LIMITS = { word: VOCAB_WORD_MAX_LENGTH, display: VOCAB_WORD_MAX_LENGTH, phonetic: 160, def: 3000, sentence: 400, source: 200 };
const FIELD_LABELS = { word: "单词或短语", display: "显示拼写", phonetic: "音标", def: "释义", sentence: "原句", source: "来源" };
/** Return an actionable error without coercing or truncating user/model text. */
export function validateVocabularyEntry(entry, { allowNonWords = false } = {}) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.word !== "string") return "每条词条必须包含文字格式的单词；请检查词表内容。";
  for (const [field, max] of Object.entries(IMPORT_FIELD_LIMITS)) {
    if (entry[field] !== undefined && typeof entry[field] !== "string") return `${FIELD_LABELS[field]}必须是文字；请修正后重试。`;
    if (typeof entry[field] === "string" && entry[field].length > max) return `${FIELD_LABELS[field]}最多 ${max} 个字符；请缩短后重试。`;
  }
  if (!allowNonWords && !isVocabularyWord(entry.word)) return "请填写有效的英文单词或短语（最多 5 个词），或取消这条内容。";
  return "";
}
const stripNumber = (value) => value.replace(/^\s*(?:\d+[.)、]|\d+\s+|[•·●▪]\s*)\s*/, "");
export function isVocabularyWord(value) {
  const word = text(value).normalize("NFC").replace(/[’‘]/g, "'");
  return !!word && word.length <= 80 && word.split(/\s+/).length <= 5
    && /^[\p{Script=Latin}\p{M}]+(?:['-][\p{Script=Latin}\p{M}]+)*(?:\s+[\p{Script=Latin}\p{M}]+(?:['-][\p{Script=Latin}\p{M}]+)*)*$/u.test(word)
    && !/^(?:I|he|she|we|they|you|it)\s+(?:am|is|are|was|were|have|has|do|does|will|can|should)\b/i.test(word);
}
export function normalizeVocabularyItems(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const items = [], seen = new Map();
  let skipped = 0, duplicates = 0;
  for (const input of list) {
    const entry = typeof input === "string" ? { word: input } : input;
    const display = text(entry?.word || entry?.display).normalize("NFC").replace(/[’‘]/g, "'").replace(/\s+/g, " ");
    if (!isVocabularyWord(display)) { skipped++; continue; }
    const word = display.toLowerCase();
    const item = { word, display, phonetic: cleanPhonetic(entry.phonetic), def: text(entry.def), sentence: text(entry.sentence), source: text(entry.source), ...(entry.uncertain === true ? { uncertain: true } : {}) };
    const validationError = validateVocabularyEntry({ ...entry, word: display, display });
    if (validationError) item.validationError = validationError;
    if (seen.has(word)) {
      duplicates++;
      const previous = seen.get(word);
      // Only fill blanks within this preview. Saved cards are never changed here.
      for (const field of ["phonetic", "def", "sentence", "source"]) if (!previous[field]) previous[field] = item[field];
      previous.validationError = validateVocabularyEntry(previous) || previous.validationError || "";
    } else { seen.set(word, item); items.push(item); }
  }
  const warnings = [];
  if (skipped) warnings.push(`已跳过 ${skipped} 条无法确定为单词或短语的内容。`);
  if (duplicates) warnings.push(`已合并表内 ${duplicates} 条重复词。`);
  for (const item of items) if (item.validationError) warnings.push(`「${item.display}」：${item.validationError}`);
  return { items, warnings, skipped, duplicates };
}
/** RFC-style quoted cells, including embedded commas/newlines and doubled quotes. */
export function parseDelimitedRows(input, delimiter = ",") {
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || !cell) quoted = !quoted;
      else cell += c;
    } else if (!quoted && c === delimiter) { row.push(cell); cell = ""; }
    else if (!quoted && (c === "\n" || c === "\r")) {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(cell); if (row.some((v) => v.trim())) rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  row.push(cell); if (row.some((v) => v.trim())) rows.push(row);
  if (quoted) throw new Error("表格中有未闭合的引号，请检查 CSV 文件。");
  return rows;
}
export function parseVocabularyRows(rows) {
  rows = (rows || []).filter((r) => r.some((c) => text(c)));
  const first = rows[0] || [];
  const headerColumns = (row) => {
    const matches = row.map((value) => Object.keys(HEADERS).find((key) => HEADERS[key].test(text(value))) || "");
    // A real table header has distinct field labels, including a word column.
    // ["word", "单词"] is a bilingual data row, not two word columns.
    const labels = matches.filter(Boolean);
    if (!labels.includes("word") || labels.length < 2 || new Set(labels).size !== labels.length) return null;
    // Extra columns (notes, part of speech, etc.) may be ignored once the
    // distinct word + content labels establish the header's structure.
    return Object.fromEntries(matches.flatMap((key, index) => key ? [[key, index]] : []));
  };
  const columns = headerColumns(first);
  const hasHeader = !!columns;
  const indexed = !hasHeader && rows.length > 0 && rows.every((row) => /^\d+$/.test(String(row[0] ?? "")) && isVocabularyWord(text(row[1])));
  const fields = hasHeader ? columns : indexed ? { word: 1, def: 2, phonetic: 3, sentence: 4 } : { word: 0, def: 1, phonetic: 2, sentence: 3 };
  const entries = rows.slice(hasHeader ? 1 : 0).map((row) => {
    if (headerColumns(row)) return { word: "" };
    const entry = Object.fromEntries(Object.entries(fields).map(([field, i]) => [field, field === "word" ? stripNumber(text(row[i])) : text(row[i])]));
    if (/^TreePractice(?:\s|$)/i.test(entry.word) && !entry.def && !entry.phonetic && !entry.sentence) return { word: "" };
    const parsed = parseLine(entry.word);
    if (parsed && isVocabularyWord(parsed.word)) { entry.word = parsed.word; entry.phonetic = entry.phonetic || parsed.phonetic; entry.def = entry.def || parsed.def; entry.sentence = entry.sentence || parsed.sentence; }
    return entry;
  });
  return normalizeVocabularyItems(entries);
}
function parseLine(raw) {
  let line = stripNumber(raw.trim());
  if (/^vocabulary(?:\s+list)?(?:\s*[-–—]\s*unit\s*\d+)?$/i.test(line)) return null;
  if (/^(?:TREEPRACTICE|TreePractice)(?:\s+VOCABULARY)?$/i.test(line)) return null;
  if (/^(?:自测\s*[|｜]|单词\s*·\s*音标|中文释义)/.test(line)) return null;
  if (!line || /^(?:page\s*\d+|第\s*\d+\s*页|\d+\s*\/\s*\d+|\d+|TOEFL\s*(?:vocabulary|单词本)|单词本|单词\s*[\/｜|]\s*释义|word\s*[\/｜|]\s*(?:meaning|definition))/i.test(line)) return null;
  if (/^(?:word|meaning|definition|phonetic|sentence|单词|释义|音标|例句)$/i.test(line)) return null;
  let phonetic = "";
  line = line.replace(/(?:\[[^\]\r\n]{1,100}\]|\/[^\/\r\n]{1,100}\/)/, (match) => { phonetic = match; return " "; });
  const bilingual = line.match(/^([\p{Script=Latin}][\p{Script=Latin}\p{M}'’‘\- ]*?)\s*(?=(?:[a-z]+\.|[\u3400-\u9fff]))(.+)$/u);
  if (bilingual) return { word: bilingual[1].trim(), phonetic, def: bilingual[2].trim() };
  const parts = line.split(/\s*[：:｜|]\s*|\s+[-–—]\s+|\s{2,}/).filter(Boolean);
  if (parts.length > 1) return { word: parts[0], phonetic, def: parts[1], sentence: parts.slice(2).join(" ") };
  return { word: line.trim(), phonetic, uncertain: !phonetic && /\s/.test(line.trim()) && stripNumber(raw.trim()) === raw.trim() };
}
export function parseVocabularyText(input) {
  const value = String(input || "").replace(/^\uFEFF/, "").replace(/\u00a0/g, " ").trim();
  if (!value) return normalizeVocabularyItems([]);
  if (value.length > 2_000_000) throw new Error("文本过长，请分批导入（每批最多 200 万字符）。");
  if (/^(?:I|he|she|we|they|you|it)\s+(?:am|is|are|was|were|have|has|do|does|will|can|should)\b/i.test(value) && !/[\r\n\t,:]/.test(value)) return normalizeVocabularyItems([value]);
  if (value.includes("\t")) return parseVocabularyRows(parseDelimitedRows(value, "\t"));
  if (!/[\r\n]/.test(value) && value.includes(",") && value.split(",").every((part) => isVocabularyWord(part))) return normalizeVocabularyItems(value.split(","));
  if (value.includes(",") && (value.startsWith('"') || isVocabularyWord(value.split(/\r?\n/)[0].split(",")[0]))) return parseVocabularyRows(parseDelimitedRows(value));
  const lines = value.split(/\r?\n/), entries = []; let ignored = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const entry = parseLine(line);
    if (entry) entries.push(entry); else ignored++;
  }
  const result = normalizeVocabularyItems(entries);
  result.skipped += ignored;
  if (result.items.some((item) => item.uncertain)) result.warnings.push("部分纯英文多词行无法确定为短语还是句子，默认不选，请核对后勾选；独立词请用换行或逗号分隔。");
  if (ignored) result.warnings.push(`已忽略 ${ignored} 行标题、页码或空白内容。`);
  return result;
}
export async function extractVocabularyImages(images, { userCode, signal } = {}) {
  const form = new FormData(); form.set("userCode", String(userCode || ""));
  for (const [i, blob] of (images || []).entries()) form.append("image", blob, `vocabulary-${i + 1}.jpg`);
  const response = await fetch("/api/vocab/extract-image", { method: "POST", body: form, signal });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error(body?.error || "图片识别失败，请稍后重试。");
  const normalized = normalizeVocabularyItems(body.items);
  return { items: normalized.items, warnings: [...(body.warnings || []), ...normalized.warnings] };
}
export async function enrichVocabularyItems(items, { onProgress, signal } = {}) {
  const { lookupWord } = await import("../dict/lookup");
  const { naiveStems } = await import("../dict/core");
  const output = items.map((item) => ({ ...item })); let cursor = 0, completed = 0;
  await Promise.all(Array.from({ length: Math.min(4, output.length) }, async () => {
    while (cursor < output.length) {
      if (signal?.aborted) throw new DOMException("已取消", "AbortError");
      const i = cursor++, item = output[i];
      if (!item.def || !item.phonetic) {
        const hit = await lookupWord(item.word).catch(() => null);
        const queried = String(hit?.queried || "").toLowerCase(), lemma = String(hit?.word || "").toLowerCase();
        const exact = queried === item.word || lemma === item.word;
        const inflected = !item.word.includes(" ") && lemma.length >= 3 && naiveStems(item.word).includes(lemma);
        if (hit && (exact || inflected)) {
          if (!item.def) item.def = hit.t || "";
          if (!item.phonetic && lemma === item.word) item.phonetic = cleanPhonetic(hit.p || "");
        }
      }
      onProgress?.({ completed: ++completed, total: output.length });
    }
  }));
  return output;
}
