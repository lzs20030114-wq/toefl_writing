import { parseVocabularyText, parseVocabularyRows, parseDelimitedRows, normalizeVocabularyItems, isVocabularyWord } from "./importVocabulary";
export { extractVocabularyImages } from "./importVocabulary";
export const MAX_VOCAB_FILE_BYTES = 10 * 1024 * 1024;
const extensions = new Set(["txt", "csv", "tsv", "xlsx", "docx", "pdf", "png", "jpg", "jpeg", "webp"]);
export function decodeVocabularyBytes(buffer) {
  const bytes = new Uint8Array(buffer), warnings = []; let value;
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) { value = new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2)); warnings.push("已按 UTF-16 LE 编码读取文件。"); }
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) { value = new TextDecoder("utf-16be", { fatal: true }).decode(bytes.subarray(2)); warnings.push("已按 UTF-16 BE 编码读取文件。"); }
    else {
      try { value = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { value = new TextDecoder("gb18030", { fatal: true }).decode(bytes); warnings.push("文件不是 UTF-8，已按 GB18030 / GBK 读取，请核对中文释义。"); }
    }
  } catch { throw new Error("无法确定文件文字编码，请保存为 UTF-8 后重试。"); }
  if (value.includes("\uFFFD")) throw new Error("文件含有无法还原的乱码，请重新保存为 UTF-8 后重试。");
  return { text: value.replace(/^\uFEFF/, ""), warnings };
}
function canvasBlob(canvas, quality) { return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法处理图片。")), "image/jpeg", quality)); }
async function compactCanvas(canvas) {
  for (const quality of [0.85, 0.7, 0.5, 0.3]) { const blob = await canvasBlob(canvas, quality); if (blob.size <= 1024 * 1024) return blob; }
  throw new Error("图片压缩后仍过大，请裁剪或降低分辨率后重试。");
}
async function resizeImage(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas"); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await compactCanvas(canvas);
  } finally { bitmap.close(); }
}
/** Reconstruct PDF rows while preserving column boundaries. */
function pdfEntriesText(entries) {
  const quote = (v) => `"${String(v || "").replace(/"/g, '""')}"`;
  return [["word", "phonetic", "meaning", "example"], ...entries.map((e) => [e.word, e.phonetic, e.def, e.sentence])].map((r) => r.map(quote).join("\t")).join("\n");
}
export function reconstructPdfVocabularyText(raw, pageWidth = 600, notebookState) {
  const tokens = raw.filter((t) => t.str?.trim()).map((t) => ({ text: t.str.trim(), x: t.transform[4], y: t.transform[5], width: t.width || 0 })).sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const token of tokens) {
    let row = rows.find((r) => Math.abs(r.y - token.y) <= 3);
    if (!row) { row = { y: token.y, tokens: [] }; rows.push(row); } row.tokens.push(token);
  }
  // Our printable notebook stacks IPA, wrapped words, meanings and examples.
  const joined = (tokens) => tokens.sort((a, b) => a.x - b.x).reduce((out, token, index, list) => {
    const gap = index ? token.x - list[index - 1].x - list[index - 1].width : 0;
    return out + (out && gap > 1.5 ? " " : "") + token.text;
  }, "");
  const ownHeader = rows.find((row) => /单词\s*·\s*音标/.test(joined(row.tokens)) && /中文释义/.test(joined(row.tokens)));
  if (notebookState) notebookState.isOwnPage = Boolean(ownHeader);
  if (ownHeader) {
    const wordX = ownHeader.tokens.find((t) => /单词/.test(t.text)).x, defX = ownHeader.tokens.find((t) => /中文释义/.test(t.text)).x;
    const body = rows.filter((r) => r.y < ownHeader.y - 3);
    // Only our explicit continuation marker permits carrying a row across pages.
    // A normal page starts a new card even when the previous card has no IPA.
    const continuation = body[0]?.tokens.some((t) => t.text === "续" && t.x < wordX - 3);
    const entries = notebookState?.entries || [];
    let current = continuation ? notebookState?.current || null : null;
    let inSentence = Boolean(current && notebookState.inSentence), inPhonetic = Boolean(current && notebookState.inPhonetic), previousY = null;
    for (const row of body) {
      const ordered = row.tokens.filter((t) => !(t.text === "续" && t.x < wordX - 3)).sort((a, b) => a.x - b.x), full = joined(ordered);
      if (!full) continue;
      if (/TreePractice|单词复习|^\d+\s*\/\s*\d+$/.test(full)) continue;
      const left = joined(ordered.filter((t) => t.x >= wordX - 3 && t.x < defX - 15));
      const right = joined(ordered.filter((t) => t.x >= defX - 15));
      const close = previousY !== null ? previousY - row.y < 28 : Boolean(continuation && current);
      if (/^原句\s*/.test(full)) {
        if (current) current.sentence = full.replace(/^原句\s*/, ""); inSentence = true; inPhonetic = false;
      } else if (current && inSentence && close) current.sentence += ` ${full}`;
      else if (current && (/^\//.test(left) || inPhonetic && close)) {
        current.phonetic += left; inPhonetic = !/\/$/.test(left);
        if (right) current.def += ` ${right}`;
      } else if (isVocabularyWord(left)) {
        if (current && !current.phonetic && !inSentence && close) {
          // A word wrapped by the printable column is split without whitespace.
          current.word += left; if (right) current.def += ` ${right}`;
        } else { current = { word: left, phonetic: "", def: right, sentence: "" }; entries.push(current); }
        inSentence = false; inPhonetic = false;
      } else if (current && right) current.def += ` ${right}`;
      previousY = row.y;
    }
    if (notebookState) Object.assign(notebookState, { entries, current, inSentence, inPhonetic });
    return pdfEntriesText(entries);
  }
  if (notebookState) notebookState.current = null;
  const lines = [];
  for (const row of rows) {
    const cells = row.tokens.sort((a, b) => a.x - b.x); let line = "", prev = null;
    for (const cell of cells) {
      const gap = prev ? cell.x - prev.x - prev.width : 0;
      const newColumn = prev && gap > pageWidth * 0.12 && /[\u3400-\u9fff]/.test(line) && /^[a-zA-Z]/.test(cell.text);
      if (newColumn) { lines.push(line); line = ""; }
      line += (line ? gap > 12 ? "  " : " " : "") + cell.text; prev = cell;
    }
    if (line) lines.push(line);
  }
  const header = lines.findIndex((line) => /\bword\b|单词/i.test(line) && /\bmeaning\b|\bdefinition\b|释义/i.test(line));
  if (header >= 0) return lines.slice(header).map((line) => line.split(/\s{2,}/).join("\t")).join("\n");
  return lines.join("\n");
}
/** Selectable headers do not make a scanned image into a text vocabulary page. */
export function hasLargePdfRaster(operatorList, OPS, width, height) {
  const area = width * height; let matrix = [1, 0, 0, 1, 0, 0]; const stack = [];
  const paint = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject]);
  for (let i = 0; i < operatorList.fnArray.length; i++) {
    const op = operatorList.fnArray[i], args = operatorList.argsArray[i];
    if (op === OPS.save) stack.push([...matrix]);
    else if (op === OPS.restore) matrix = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (op === OPS.transform) {
      const [a,b,c,d,e,f] = matrix, [g,h,j,k,l,m] = args;
      matrix = [a*g+c*h,b*g+d*h,a*j+c*k,b*j+d*k,a*l+c*m+e,b*l+d*m+f];
    } else if (paint.has(op) && Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) / area >= 0.2) return true;
  }
  return false;
}
async function readPdf(buffer, onProgress) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }); let pdf;
  try {
    pdf = await task.promise;
    if (pdf.numPages > 30) throw new Error("PDF 超过 30 页，请拆成较小文件后导入。");
    const entries = [], images = [], notebookState = { entries: [] }; let skipped = 0, duplicates = 0; const warnings = [];
    const appendParsed = (parsed) => {
      entries.push(...parsed.items); skipped += parsed.skipped; duplicates += parsed.duplicates; warnings.push(...parsed.warnings);
    };
    const flushNotebook = () => {
      if (notebookState.entries.length) appendParsed(parseVocabularyText(pdfEntriesText(notebookState.entries)));
      notebookState.entries = []; notebookState.current = null;
    };
    for (let i = 1; i <= pdf.numPages; i++) {
      onProgress?.({ completed: i - 1, total: pdf.numPages });
      const page = await pdf.getPage(i), content = await page.getTextContent();
      const rawText = content.items.map((t) => t.str || "").join(" ").trim();
      const baseViewport = page.getViewport({ scale: 1 });
      const parsed = parseVocabularyText(reconstructPdfVocabularyText(content.items, baseViewport.width));
      const sparseText = rawText.length < 400 && parsed.items.filter((item) => !item.uncertain).length <= 5;
      const largeRaster = sparseText && typeof page.getOperatorList === "function"
        ? hasLargePdfRaster(await page.getOperatorList(), pdfjs.OPS, baseViewport.width, baseViewport.height) : false;
      const scanned = !rawText || largeRaster;
      if (!scanned) {
        reconstructPdfVocabularyText(content.items, baseViewport.width, notebookState);
        if (!notebookState.isOwnPage) {
          flushNotebook(); appendParsed(parsed);
        }
      } else {
        flushNotebook();
        if (images.length >= 3) throw new Error("PDF 含有超过 3 页扫描内容，请拆成每份最多 3 个扫描页后重试。本次尚未导入任何单词。");
        const base = page.getViewport({ scale: 1 }), viewport = page.getViewport({ scale: Math.min(2, 1600 / Math.max(base.width, base.height)) });
        const canvas = document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport, background: "white" }).promise;
        images.push(await compactCanvas(canvas));
      }
      page.cleanup(); onProgress?.({ completed: i, total: pdf.numPages });
    }
    flushNotebook();
    const result = normalizeVocabularyItems(entries);
    if (result.items.length > 5000) throw new Error("一次最多预览 5000 个词，请分批导入。");
    return { ...result, skipped: result.skipped + skipped, duplicates: result.duplicates + duplicates, warnings: [...new Set([...warnings, ...result.warnings])], images };
  } finally { if (pdf) await pdf.destroy(); else await task.destroy(); }
}
async function unpackDocument(buffer) {
  const { unzipSync } = await import("fflate");
  let expanded = 0;
  return unzipSync(new Uint8Array(buffer), { filter: (entry) => {
    expanded += entry.originalSize;
    if (expanded > 25 * 1024 * 1024) throw new Error("文件解压后超过 25 MB，请拆分后重试。");
    return /^(?:word\/document\.xml|xl\/(?:worksheets\/sheet\d+|sharedStrings|workbook)\.xml)$/.test(entry.name);
  } });
}
export async function readVocabularyFile(file, { onProgress } = {}) {
  if (!file || typeof file.arrayBuffer !== "function") throw new Error("请选择一个文件。");
  if (file.size > MAX_VOCAB_FILE_BYTES) throw new Error("文件超过 10 MB，请拆分或压缩后重试。");
  const ext = String(file.name || "").split(".").pop().toLowerCase();
  if (!extensions.has(ext)) throw new Error("支持 TXT、CSV、TSV、XLSX、DOCX、PDF、PNG、JPG 和 WebP。");
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) return { ...normalizeVocabularyItems([]), images: [await resizeImage(file)] };
  const buffer = await file.arrayBuffer();
  if (ext === "pdf") return readPdf(buffer, onProgress);
  let result;
  if (ext === "xlsx") {
    // Inspect ZIP sizes and sheet ranges before the general-purpose spreadsheet reader allocates rows.
    const unpacked = await unpackDocument(buffer); const decoder = new TextDecoder();
    for (const [path, bytes] of Object.entries(unpacked)) {
      if (!/worksheets/.test(path)) continue;
      const range = decoder.decode(bytes).match(/<dimension[^>]*ref="(?:[^:"]+:)?([A-Z]+)(\d+)"/);
      if (range && (Number(range[2]) > 10000 || range[1].length > 2)) throw new Error("表格范围过大，请仅保留单词表区域后重试。");
      if ((decoder.decode(bytes).match(/<row\b/g) || []).length > 10000) throw new Error("表格超过 10000 行，请分批导入。");
    }
    const { default: readXlsx } = await import("read-excel-file/browser");
    const sheets = await readXlsx(buffer); const entries = []; let skipped = 0, duplicates = 0; const warnings = [];
    for (const sheet of sheets) {
      const parsed = parseVocabularyRows(sheet.data);
      entries.push(...parsed.items); skipped += parsed.skipped; duplicates += parsed.duplicates; warnings.push(...parsed.warnings);
    }
    result = normalizeVocabularyItems(entries);
    result = { ...result, skipped: result.skipped + skipped, duplicates: result.duplicates + duplicates, warnings: [...new Set([...warnings, ...result.warnings])] };
  } else if (ext === "docx") {
    const zip = await unpackDocument(buffer);
    if (!zip["word/document.xml"]) throw new Error("DOCX 中没有可读取的正文。");
    const xml = new DOMParser().parseFromString(new TextDecoder().decode(zip["word/document.xml"]), "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("DOCX 正文损坏，请重新导出文件。");
    const joinText = (root) => {
      const visit = (node) => {
        if (node.nodeType !== 1) return "";
        if (node.tagName === "w:t") return node.textContent;
        if (node.tagName === "w:br" || node.tagName === "w:cr") return "\n";
        if (node.tagName === "w:tab") return "\t";
        const text = Array.from(node.childNodes).map(visit).join("");
        return node.tagName === "w:p" && node !== root ? `${text}\n` : text;
      };
      return visit(root).trim();
    };
    const paragraphs = Array.from(xml.getElementsByTagName("w:p"));
    const tables = Array.from(xml.getElementsByTagName("w:tbl")).map((table) => Array.from(table.getElementsByTagName("w:tr")).map((row) => Array.from(row.getElementsByTagName("w:tc")).map(joinText)));
    const plain = paragraphs.filter((p) => { let n = p.parentElement; while (n) { if (n.tagName === "w:tc") return false; n = n.parentElement; } return true; });
    const parsed = [...tables.map(parseVocabularyRows), parseVocabularyText((tables.length ? plain : paragraphs).map(joinText).join("\n"))];
    result = normalizeVocabularyItems(parsed.flatMap((p) => p.items));
    result = { ...result, skipped: result.skipped + parsed.reduce((sum, p) => sum + p.skipped, 0), duplicates: result.duplicates + parsed.reduce((sum, p) => sum + p.duplicates, 0), warnings: [...new Set([...parsed.flatMap((p) => p.warnings), ...result.warnings])] };
  } else {
    const decoded = decodeVocabularyBytes(buffer), value = decoded.text;
    result = ext === "csv" || ext === "tsv" ? parseVocabularyRows(parseDelimitedRows(value, ext === "tsv" ? "\t" : ",")) : parseVocabularyText(value);
    result.warnings.push(...decoded.warnings);
  }
  if (result.items.length > 5000) throw new Error("一次最多预览 5000 个词，请分批导入。");
  return { ...result, images: [] };
}
