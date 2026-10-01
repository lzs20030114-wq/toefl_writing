/** Browser-local vocabulary PDF. Heavy libraries and licensed fonts load only on export. */
const FONT_URLS = ['/fonts/pdf/NotoSansSC-Regular.ttf', '/fonts/pdf/NotoSans-Regular.ttf'];
const MAX_CARDS = 1000;
let fontBytesPromise;

async function loadFontBytes() {
  if (!fontBytesPromise) {
    fontBytesPromise = Promise.all(FONT_URLS.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('PDF 字体加载失败，请检查网络后重试。');
      return new Uint8Array(await response.arrayBuffer());
    })).catch((error) => { fontBytesPromise = null; throw error; });
  }
  return fontBytesPromise;
}

function cleanText(value) {
  return String(value || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\t/g, '  ').trim();
}

function validateCards(cards) {
  if (!Array.isArray(cards) || !cards.length) throw new Error('请先选择要导出的单词。');
  if (cards.length > MAX_CARDS) throw new Error('每次最多导出 1000 个单词，请分批导出。');
  let length = 0;
  const rows = cards.map((card, i) => {
    const word = cleanText(card?.display || card?.word);
    if (!word) throw new Error(`第 ${i + 1} 个单词为空，请检查后重试。`);
    const phonetic = cleanText(card.phonetic);
    const def = cleanText(card.def || card.defFull || '暂无释义');
    const sentence = cleanText(card.sentence);
    for (const field of [word, phonetic, def, sentence]) {
      if (field.length > 20000) throw new Error(`「${word.slice(0, 30)}」的内容过长，请精简后导出。`);
      length += field.length;
    }
    return { word, phonetic, def, sentence };
  });
  if (length > 2000000) throw new Error('所选内容过多，请分批导出。');
  return rows;
}

function dateLabel(date) {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) throw new Error('导出日期无效。');
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function vocabularyPdfFilename(title = '我的单词表', date = new Date()) {
  const safe = cleanText(title).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/[. ]+$/g, '').slice(0, 80) || '我的单词表';
  return `${safe}-${dateLabel(date)}.pdf`;
}

/** Return a real PDF as Uint8Array. No card content leaves the browser. */
export async function createVocabularyPdf(cards, { title = '我的单词表', includeSentences = true, date = new Date() } = {}) {
  const rows = validateCards(cards);
  const heading = cleanText(title) || '我的单词表';
  if (heading.length > 200) throw new Error('标题最多 200 个字符，请缩短后重试。');
  const exportedAt = dateLabel(date);
  const [{ PDFDocument, rgb }, fontkitModule, bytes] = await Promise.all([
    import('pdf-lib'), import('@pdf-lib/fontkit'), loadFontBytes(),
  ]);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkitModule.default || fontkitModule);
  const [cjk, latin] = await Promise.all(bytes.map((data) => doc.embedFont(data, { subset: true, features: { liga: false } })));
  const cjkChars = new Set(cjk.getCharacterSet());
  const latinChars = new Set(latin.getCharacterSet());
  const glyphWidths = new Map();
  function fontFor(char) {
    const cp = char.codePointAt(0);
    if (cp < 0x3000 && latinChars.has(cp)) return latin;
    if (cjkChars.has(cp)) return cjk;
    if (latinChars.has(cp)) return latin;
    throw new Error(`PDF 字体暂不支持字符「${char}」（U+${cp.toString(16).toUpperCase()}），请修改该字符后重试。`);
  }
  function charWidth(char, size) {
    const key = `${size}:${char}`;
    if (!glyphWidths.has(key)) glyphWidths.set(key, fontFor(char).widthOfTextAtSize(char, size));
    return glyphWidths.get(key);
  }
  function textWidth(text, size) { return Array.from(text).reduce((sum, char) => sum + charWidth(char, size), 0); }
  function wrap(text, width, size) {
    const out = [];
    for (const paragraph of text.split('\n')) {
      let line = '', used = 0;
      // Keep English words intact when possible; oversized tokens break safely by Unicode code point.
      for (const token of paragraph.match(/\S+\s*|\s+/gu) || ['']) {
        const tokenWidth = textWidth(token, size);
        if (line && used + tokenWidth > width) { out.push(line.trimEnd()); line = ''; used = 0; }
        for (const char of token) {
          const cw = charWidth(char, size);
          if (line && used + cw > width) { out.push(line.trimEnd()); line = ''; used = 0; }
          if (!line && /\s/u.test(char)) continue;
          line += char; used += cw;
        }
      }
      out.push(line.trimEnd());
    }
    return out;
  }
  const W = 595.28, H = 841.89, M = 36, RIGHT = W - M, BOTTOM = 54;
  const green = rgb(0.157, 0.361, 0.275), ink = rgb(0.15, 0.19, 0.17), muted = rgb(0.40, 0.45, 0.42);
  const pale = rgb(0.91, 0.95, 0.92), rule = rgb(0.80, 0.85, 0.81);
  const WORD_X = M + 40, WORD_W = 173, DEF_X = WORD_X + WORD_W + 16, DEF_W = RIGHT - DEF_X - 10;
  const LINE = 16, PAD = 11;
  let page, y, pageStart;
  function drawText(text, x, top, size = 10, color = ink) {
    let run = '', font, pen = x;
    function flush() {
      if (!run) return;
      page.drawText(run, { x: pen, y: H - top - size, size, font, color });
      pen += textWidth(run, size); run = '';
    }
    for (const char of text) {
      const next = fontFor(char);
      if (font && next !== font) flush();
      font = next; run += char;
    }
    flush();
  }
  function line(top, x1 = M, x2 = RIGHT) {
    page.drawLine({ start: { x: x1, y: H - top }, end: { x: x2, y: H - top }, thickness: 0.5, color: rule });
  }
  const titleLines = wrap(heading, W - 2 * M, 22);
  function newPage() {
    page = doc.addPage([W, H]);
    page.drawRectangle({ x: M, y: H - 41, width: 3, height: 13, color: green });
    drawText('TreePractice', M + 11, 28, 10, green);
    let top = 53;
    titleLines.forEach((text) => { drawText(text, M, top, 22); top += 29; });
    drawText(`${exportedAt}   /   ${rows.length} 个单词`, M, top + 3, 10, muted);
    top += 33;
    page.drawRectangle({ x: M, y: H - top - 27, width: W - M * 2, height: 27, color: pale });
    drawText('自测', M + 6, top + 6, 10, green);
    drawText('单词 · 音标', WORD_X, top + 6, 10, green);
    drawText('中文释义', DEF_X, top + 6, 10, green);
    y = top + 27; pageStart = y;
  }
  newPage();
  const capacity = H - BOTTOM - pageStart;
  for (const row of rows) {
    const wordLines = wrap(row.word, WORD_W, 12).map((text) => ({ text, size: 12, color: ink }));
    const ipaLines = row.phonetic ? wrap(`/${row.phonetic.replace(/^\/+|\/+$/g, '')}/`, WORD_W, 10).map((text) => ({ text, size: 10, color: muted })) : [];
    const left = [...wordLines, ...ipaLines];
    const right = wrap(row.def, DEF_W, 10);
    const coreCount = Math.max(left.length, right.length);
    const sentenceLines = includeSentences && row.sentence ? wrap(`原句  ${row.sentence}`, RIGHT - WORD_X - 10, 10) : [];
    const fullHeight = PAD * 2 + coreCount * LINE + (sentenceLines.length ? 7 + sentenceLines.length * LINE : 0);
    if (fullHeight <= capacity && y + fullHeight > H - BOTTOM) newPage();
    let coreIndex = 0, sentenceIndex = 0, first = true;
    while (coreIndex < coreCount || sentenceIndex < sentenceLines.length) {
      const remaining = H - BOTTOM - y;
      if (remaining < PAD * 2 + LINE) newPage();
      const start = y;
      y += PAD;
      if (first) page.drawRectangle({ x: M + 11, y: H - y - 10, width: 10, height: 10, borderWidth: 0.7, borderColor: muted });
      else drawText('续', M + 11, y, 9, muted);
      while (coreIndex < coreCount && y + LINE + PAD <= H - BOTTOM) {
        const item = left[coreIndex];
        if (item) drawText(item.text, WORD_X, y, item.size, item.color);
        if (right[coreIndex]) drawText(right[coreIndex], DEF_X, y, 10);
        coreIndex++; y += LINE;
      }
      if (coreIndex === coreCount && sentenceIndex < sentenceLines.length) {
        y += 7;
        while (sentenceIndex < sentenceLines.length && y + LINE + PAD <= H - BOTTOM) {
          drawText(sentenceLines[sentenceIndex++], WORD_X, y, 10, muted); y += LINE;
        }
      }
      y = Math.min(y + PAD, H - BOTTOM);
      line(y);
      // start is retained for the minimum-height guarantee on rows with empty optional fields.
      if (y <= start) throw new Error('PDF 排版失败，请分批导出。');
      first = false;
      if (coreIndex < coreCount || sentenceIndex < sentenceLines.length) newPage();
    }
  }
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    page = p;
    line(H - 39);
    drawText('TreePractice  /  单词复习', M, H - 29, 9, muted);
    const label = `${i + 1} / ${pages.length}`;
    drawText(label, RIGHT - textWidth(label, 9), H - 29, 9, muted);
  });
  doc.setTitle(heading); doc.setAuthor('TreePractice'); doc.setSubject('Vocabulary review');
  doc.setCreationDate(new Date(date)); doc.setModificationDate(new Date(date));
  return doc.save();
}

/** Download through a Blob URL, never invoking a print dialog. */
export async function downloadVocabularyPdf(cards, options = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') throw new Error('请在浏览器中下载 PDF。');
  const date = options.date || new Date();
  const bytes = await createVocabularyPdf(cards, { ...options, date });
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const anchor = document.createElement('a');
  try {
    anchor.href = url; anchor.download = vocabularyPdfFilename(options.title, date);
    document.body.appendChild(anchor); anchor.click();
  } finally {
    anchor.remove();
    // Safari may read the URL after the click callback returns.
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  return bytes;
}

