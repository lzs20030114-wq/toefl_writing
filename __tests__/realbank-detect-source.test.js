/**
 * 源格式探测判据（scripts/realbank/detect_source.mjs 的纯函数部分）。
 *
 * 这条闸决定「拿哪个解析器跑这一套卷」。判错的代价不是报错，而是**静默产出错题**：
 * 拿 ingest_set.py 去啃截图 docx 会得到一整套空题面，拿 parse_reformatted.py 去啃
 * 第一来源 PDF 会得到一堆错位答案 —— 两者都能跑完、都会 exit 0。所以判不准时必须
 * 落到 unknown（Worker 见到就停在 needs_format 让人选），永远不许猜。
 *
 * fixture 一律是文件名 + 造出来的 probe 数字，不碰任何真题源文件。
 */
const {
  detectKind, needsHuman, MIN_CONFIDENCE,
  DOCX_WORDS_MIN, DOCX_IMAGES_MIN,
} = require("../scripts/realbank/detect_source.mjs");

const f = (p, size = 1024) => ({ path: p, size });

describe("detectKind — first_pdf（第一来源）", () => {
  const firstSourceFiles = [
    f("3.24 阅读.pdf", 4e6), f("3.24 听力.pdf", 3e6), f("3.24 写作.pdf", 1e6),
    f("3.24 口语.pdf", 1e6), f("3.24 答案.pdf", 2e5),
    f("Listening-Module1.mp3", 2e7), f("Speaking.mp3", 6e6),
  ];
  const denseProbe = { pdf: { files: 5, pages: 60, body_chars: 60000, chars_per_page: 1000, has_answer_pdf: true } };

  test("文字层密度够 + 有答案 PDF → first_pdf，高置信", () => {
    const r = detectKind(firstSourceFiles, denseProbe);
    expect(r.kind).toBe("first_pdf");
    expect(r.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
    expect(needsHuman(r)).toBe(false);
  });

  test("纯扫描件（密度不够）但有答案 PDF 仍收：OCR 分支就是给它准备的", () => {
    const r = detectKind(firstSourceFiles, {
      pdf: { files: 5, pages: 60, body_chars: 700, chars_per_page: 11.7, has_answer_pdf: true },
    });
    expect(r.kind).toBe("first_pdf");
  });

  test("没有答案 PDF 也没有文字层 → unknown（缺答案页的扫描件不许硬跑）", () => {
    const r = detectKind(
      [f("阅读.pdf", 4e6), f("听力.pdf", 3e6)],
      { pdf: { files: 2, pages: 30, body_chars: 300, chars_per_page: 10, has_answer_pdf: false } },
    );
    expect(r.kind).toBe("unknown");
    expect(needsHuman(r)).toBe(true);
  });

  test("PDF 与 docx 混装 → unknown（不猜该走哪条线）", () => {
    const r = detectKind(
      [f("答案.pdf"), f("阅读.docx"), f("听力.docx"), f("写作.docx")],
      { pdf: { files: 1, pages: 2, body_chars: 3000, chars_per_page: 1500, has_answer_pdf: true },
        docx: { files: 3, images: 40, words: 20 } },
    );
    expect(r.kind).toBe("unknown");
  });
});

describe("detectKind — docx 两支", () => {
  const docxFiles = [f("阅读.docx", 8e6), f("听力.docx", 6e6), f("答案.docx", 3e4)];

  test("截图套壳：图多字少 → screenshot_docx", () => {
    const r = detectKind(docxFiles, { docx: { files: 3, images: DOCX_IMAGES_MIN + 20, words: 80 } });
    expect(r.kind).toBe("screenshot_docx");
    expect(needsHuman(r)).toBe(false);
  });

  test("文本原生 + 逐题 mp3 → vendor_docx", () => {
    const files = [...docxFiles, f("Q1.mp3"), f("Q2.mp3"), f("Q3.mp3")];
    const r = detectKind(files, { docx: { files: 3, images: 0, words: DOCX_WORDS_MIN + 2000 } });
    expect(r.kind).toBe("vendor_docx");
  });

  test("文本原生 + 文件名带「第N题」 → vendor_docx", () => {
    const files = [...docxFiles, f("第1题.mp3"), f("第2题.mp3")];
    const r = detectKind(files, { docx: { files: 3, images: 0, words: 4000 } });
    expect(r.kind).toBe("vendor_docx");
  });

  test("文本原生但没有逐题音频 → unknown（置信度不够，交人工）", () => {
    const r = detectKind(docxFiles, { docx: { files: 3, images: 0, words: 4000 } });
    expect(r.kind).toBe("unknown");
    expect(needsHuman(r)).toBe(true);
  });

  test("图不够多、字也不够多 → unknown", () => {
    const r = detectKind(docxFiles, { docx: { files: 3, images: 3, words: 300 } });
    expect(r.kind).toBe("unknown");
  });

  test("答案 docx 的文本不计进判据（否则截图套壳的卷判不出来）", () => {
    // 实测 5.20：四科正文 85 词 / 102 张图，答案页另有 270 词。按总数（355 词）算就顶穿
    // 「< 200 词」这条判据，判成 unknown；按正文算才是 screenshot_docx。
    const probe = {
      docx: {
        files: 5, images: 102, words: 355,
        items: [
          { name: "5.20 写作.docx", images: 9, words: 85 },
          { name: "5.20 口语.docx", images: 9, words: 0 },
          { name: "5.20 听力.docx", images: 60, words: 0 },
          { name: "5.20 答案.docx", images: 0, words: 270 },
          { name: "5.20 阅读.docx", images: 24, words: 0 },
        ],
      },
    };
    const r = detectKind([f("5.20 写作.docx"), f("5.20 答案.docx")], probe);
    expect(r.kind).toBe("screenshot_docx");
    expect(r.signals.docxWords).toBe(85);
    expect(r.signals.docxImages).toBe(102);
  });

  test("没有 probe 数据时分不开两支 → unknown（绝不按文件名猜）", () => {
    const r = detectKind(docxFiles, {});
    expect(r.kind).toBe("unknown");
    expect(r.reason).toMatch(/probe/);
  });
});

describe("detectKind — 边界", () => {
  test("空目录 → unknown / 0 置信", () => {
    const r = detectKind([], {});
    expect(r.kind).toBe("unknown");
    expect(r.confidence).toBe(0);
  });

  test("只有音频 → unknown", () => {
    const r = detectKind([f("a.mp3"), f("b.mp3")], {});
    expect(r.kind).toBe("unknown");
  });

  test("signals 里带上判断依据（人工选格式时要看得见为什么判不了）", () => {
    const r = detectKind([f("x.docx")], { docx: { files: 1, images: 4, words: 300 } });
    expect(r.signals).toMatchObject({ docxFiles: 1, docxImages: 4, docxWords: 300 });
  });

  test("needsHuman 的门就是 MIN_CONFIDENCE", () => {
    expect(needsHuman({ kind: "first_pdf", confidence: MIN_CONFIDENCE - 0.01 })).toBe(true);
    expect(needsHuman({ kind: "first_pdf", confidence: MIN_CONFIDENCE })).toBe(false);
    expect(needsHuman(null)).toBe(true);
  });
});
