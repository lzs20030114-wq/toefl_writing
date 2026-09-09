#!/usr/bin/env node
/**
 * 源格式探测（契约 §6）——「这一套源文件该走哪条 ingest 支线」。
 *
 * 三种已知形态（都是人工跑过的真链路，见 docs/realbank-ingest-contract.md）：
 *   first_pdf        第一来源：`写作/口语/听力/阅读/答案` 五份 PDF（+ 整块音频）→ ingest_set.py
 *   vendor_docx      第二来源：文字原生 docx + 逐题 mp3           → parse_reformatted.py
 *   screenshot_docx  截图套壳 docx（正文全是图）                  → convert_docx_set.py → ingest_set.py
 *
 * 判据（本文件，纯函数 detectKind）与量（scripts/realbank/detect_probe.py，需要 PyMuPDF /
 * python-docx）刻意分开：判据要能拿空文件 fixture 单测，量只有 python 侧量得出来。
 *
 * 置信度 < 0.8 一律返回 `unknown` —— Worker 见到就把 job 置 needs_format 停下让人选，
 * **绝不猜**：猜错的代价是拿错的解析器跑一套卷，产出一堆看着像样、答案全错位的题。
 *
 * 用法:
 *   node scripts/realbank/detect_source.mjs --dir "<套目录>" [--json]
 *   node scripts/realbank/detect_source.mjs --dir "<套目录>" --no-probe   # 只按文件名/大小判
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 与 ingest_set.py 的 TEXT_LAYER_MIN_PER_PAGE 同一个数：真文字 PDF 每页 ≥150 字。 */
export const PDF_CHARS_PER_PAGE_MIN = 150;
/** 与 ingest_set.py 的 TEXT_LAYER_MIN 同一个数。 */
export const PDF_BODY_CHARS_MIN = 200;
/** vendor_docx：文本原生 docx 的段落词数下限（契约 §6）。 */
export const DOCX_WORDS_MIN = 500;
/** screenshot_docx：内嵌图片张数下限 / 文本词数上限（契约 §6）。 */
export const DOCX_IMAGES_MIN = 10;
export const DOCX_WORDS_MAX = 200;
/** 低于这个置信度就交给人选格式。 */
export const MIN_CONFIDENCE = 0.8;

const AUDIO_EXT = new Set([".mp3", ".m4a", ".wav", ".mp4", ".mov"]);
/** 逐题音频的文件名特征：`Q3` / `第3题` / `3-1`（第二来源 vendor 包的命名）。 */
const PER_QUESTION_AUDIO = /(^|[^a-z])q\s*\d|第\s*\d+\s*题/i;
const ANSWER_HINT = /答案|answer/i;

const extOf = (p) => path.extname(String(p || "")).toLowerCase();

/**
 * 纯函数判据。
 *
 * @param {Array<{path:string,size:number}>} files 相对套目录的文件清单
 * @param {object} probe detect_probe.py 的输出（缺省 = 只按文件名/大小判，置信度会更低）
 * @returns {{kind:string, confidence:number, reason:string, signals:object}}
 */
export function detectKind(files, probe = {}) {
  const list = (files || []).filter((f) => f && f.path);
  const pdfs = list.filter((f) => extOf(f.path) === ".pdf");
  const docxs = list.filter((f) => extOf(f.path) === ".docx");
  const audios = list.filter((f) => AUDIO_EXT.has(extOf(f.path)));

  const p = probe.pdf || {};
  const d = probe.docx || {};
  const hasProbe = Boolean(probe && (probe.pdf || probe.docx));

  const stemDocx = Array.isArray(d.items) && d.items.length
    ? d.items.filter((it) => !ANSWER_HINT.test(String(it.name || "")))
      .reduce((a, it) => ({ words: a.words + (it.words || 0), images: a.images + (it.images || 0) }),
        { words: 0, images: 0 })
    : null;

  const signals = {
    pdfFiles: pdfs.length,
    docxFiles: docxs.length,
    audioFiles: audios.length,
    // 「答案 PDF」既认文件名也认 probe（probe 走的是同一条正则，但它扫的是磁盘上的真实目录）
    hasAnswerPdf: Boolean(p.has_answer_pdf) || pdfs.some((f) => ANSWER_HINT.test(f.path)),
    pdfCharsPerPage: p.chars_per_page ?? null,
    pdfBodyChars: p.body_chars ?? null,
    // 只统计**正文** docx：答案 docx 在两种形态里都是纯文本，混进总词数会把
    // 「截图套壳 = 文本 < 200 词」这条判据顶穿（实测 5.20 正文 4 份合计几十词，
    // 加上答案页就成了 355 词，直接判不出来）。probe 没给逐份明细时退回总数。
    docxWords: stemDocx ? stemDocx.words : (d.words ?? null),
    docxImages: stemDocx ? stemDocx.images : (d.images ?? null),
    perQuestionAudio: audios.some((f) => PER_QUESTION_AUDIO.test(path.basename(f.path))),
  };

  if (!list.length) {
    return { kind: "unknown", confidence: 0, reason: "目录里一个文件都没有", signals };
  }

  // ── first_pdf ────────────────────────────────────────────────────────────
  // 「PDF 文本层密度够」用的是 ingest_set.pdf_text 的同一条判据（总字数 + 每页密度），
  // 因为下游真正决定走 text-layer 还是 OCR 的就是那一条 —— 探测和执行必须同一把尺子。
  if (pdfs.length >= 1) {
    const dense = signals.pdfBodyChars != null
      && signals.pdfBodyChars >= PDF_BODY_CHARS_MIN
      && signals.pdfCharsPerPage >= PDF_CHARS_PER_PAGE_MIN;
    if (dense || signals.hasAnswerPdf) {
      // docx 也不少时说明这是个混装目录，降一档置信度让人复核。
      const mixed = docxs.length > pdfs.length;
      const conf = mixed ? 0.6 : (dense && signals.hasAnswerPdf ? 0.95 : 0.85);
      return {
        kind: mixed ? "unknown" : "first_pdf",
        confidence: conf,
        reason: mixed
          ? `PDF ${pdfs.length} 份但 docx 更多（${docxs.length} 份），混装目录，交人工选`
          : `PDF ${pdfs.length} 份${dense ? `，文字层密度 ${signals.pdfCharsPerPage} 字/页 ≥ ${PDF_CHARS_PER_PAGE_MIN}` : ""}`
            + `${signals.hasAnswerPdf ? "，含答案 PDF" : ""}`,
        signals,
      };
    }
  }

  // ── docx 两支 ────────────────────────────────────────────────────────────
  if (docxs.length >= 1) {
    if (!hasProbe) {
      // 没探针就分不开「文本原生」和「截图套壳」—— 两者文件清单长得一模一样。
      return {
        kind: "unknown",
        confidence: 0.4,
        reason: `docx ${docxs.length} 份，但没有 probe 数据，分不开 vendor/screenshot`,
        signals,
      };
    }
    const screenshot = signals.docxImages >= DOCX_IMAGES_MIN && signals.docxWords < DOCX_WORDS_MAX;
    const vendorText = signals.docxWords >= DOCX_WORDS_MIN;
    const vendorAudio = signals.perQuestionAudio || audios.length >= 6;

    if (screenshot) {
      return {
        kind: "screenshot_docx",
        confidence: 0.9,
        reason: `docx 内嵌图 ${signals.docxImages} 张 ≥ ${DOCX_IMAGES_MIN} 且文本 ${signals.docxWords} 词 < ${DOCX_WORDS_MAX}`,
        signals,
      };
    }
    if (vendorText && vendorAudio) {
      return {
        kind: "vendor_docx",
        confidence: 0.9,
        reason: `docx 文本 ${signals.docxWords} 词 ≥ ${DOCX_WORDS_MIN}，且`
          + (signals.perQuestionAudio ? "文件名带逐题编号" : `音频 ${audios.length} 个（逐题切片）`),
        signals,
      };
    }
    if (vendorText) {
      // 文本够但没有逐题音频：可能是纯写作/阅读的 vendor 包，也可能是别的东西 —— 不敢定。
      return {
        kind: "unknown",
        confidence: 0.6,
        reason: `docx 文本 ${signals.docxWords} 词够，但没有逐题音频特征，交人工选`,
        signals,
      };
    }
    return {
      kind: "unknown",
      confidence: 0.3,
      reason: `docx ${docxs.length} 份，但图 ${signals.docxImages} 张 / 文本 ${signals.docxWords} 词都够不上任一支判据`,
      signals,
    };
  }

  if (pdfs.length >= 1) {
    return {
      kind: "unknown",
      confidence: 0.5,
      reason: `PDF ${pdfs.length} 份但没有文字层也没有答案 PDF（疑似纯扫描件缺答案页）`,
      signals,
    };
  }

  return {
    kind: "unknown",
    confidence: 0,
    reason: `目录里既没有 PDF 也没有 docx（只有 ${list.length} 个其它文件）`,
    signals,
  };
}

/** confidence < MIN_CONFIDENCE 或 kind=unknown 都要人来选格式。 */
export function needsHuman(result) {
  return !result || result.kind === "unknown" || result.confidence < MIN_CONFIDENCE;
}

/** 递归列目录（相对路径 + 字节数）。忽略 __MACOSX / 点开头的垃圾文件。 */
export function listFiles(dir) {
  const out = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "__MACOSX" || e.name.startsWith(".")) continue;
      const full = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(full, r);
      else if (e.isFile()) out.push({ path: r, size: fs.statSync(full).size });
    }
  };
  walk(dir, "");
  return out;
}

/** 跑 detect_probe.py 拿量；python 不在 / 依赖缺失就返回 {}（判据自己会降置信度）。 */
export function runProbe(dir, py = process.env.REALBANK_PY || "python") {
  const script = path.join(HERE, "detect_probe.py");
  const r = spawnSync(py, [script, dir], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (r.error || r.status !== 0) return {};
  try { return JSON.parse(r.stdout); } catch { return {}; }
}

export function detectSourceDir(dir, { probe = true } = {}) {
  const files = listFiles(dir);
  return detectKind(files, probe ? runProbe(dir) : {});
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */
const isMain = Boolean(process.argv[1])
  && path.resolve(process.argv[1]) === path.join(HERE, "detect_source.mjs");
if (isMain) {
  const argv = process.argv.slice(2);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const dir = val("--dir");
  if (!dir) {
    console.error("用法: node scripts/realbank/detect_source.mjs --dir <套目录> [--json] [--no-probe]");
    process.exit(2);
  }
  if (!fs.existsSync(dir)) {
    console.error(`目录不存在: ${dir}`);
    process.exit(2);
  }
  const res = detectSourceDir(dir, { probe: !argv.includes("--no-probe") });
  if (argv.includes("--json")) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log(`kind=${res.kind}  confidence=${res.confidence}\n理由：${res.reason}`);
    if (needsHuman(res)) console.log("→ 置信度不够，需要人工选格式（job 会停在 needs_format）");
  }
}
