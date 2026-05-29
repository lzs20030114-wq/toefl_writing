#!/usr/bin/env node
// Export ONE routine session's generated items (read straight from its
// staging files) to a .docx on the real D-drive desktop (D:\桌面).
//
// Usage: node scripts/ops/export-session-to-desktop.mjs <session-id> [outpath]

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { pathToFileURL } from "url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, PageBreak } = require("docx");
const { isPersonPrefilled } = await import(pathToFileURL(resolve(ROOT, "lib/quality/scoreBatch.mjs")).href);

const SESSION = process.argv[2] || "routine-20260529-065136";

const STAGING = {
  bs:                 `data/buildSentence/staging/${SESSION}.json`,
  discussion:         `data/academicWriting/staging/${SESSION}.json`,
  email:              `data/emailWriting/staging/${SESSION}.json`,
  "reading-ap":       `data/reading/staging/ap-${SESSION}.json`,
  "reading-ctw":      `data/reading/staging/ctw-${SESSION}.json`,
  "reading-rdl-short":`data/reading/staging/rdl-${SESSION}-short.json`,
  "reading-rdl-long": `data/reading/staging/rdl-${SESSION}-long.json`,
};

function load(bank) {
  const p = resolve(ROOT, STAGING[bank]);
  if (!existsSync(p)) return [];
  try { return JSON.parse(readFileSync(p, "utf8")).items || []; } catch { return []; }
}

const bs = load("bs");
const disc = load("discussion");
const email = load("email");
const ap = load("reading-ap");
const ctw = load("reading-ctw");
const rdlShort = load("reading-rdl-short");
const rdlLong = load("reading-rdl-long");

console.log(`Session ${SESSION} staging contents:`);
console.log("  BS:", bs.length, "| Disc:", disc.length, "| Email:", email.length);
console.log("  AP:", ap.length, "| CTW:", ctw.length, "| RDL-short:", rdlShort.length, "| RDL-long:", rdlLong.length);

// person-prefilled stat for cover
const personCount = bs.filter((it) => (it.prefilled || []).some((s) => isPersonPrefilled(s))).length;
const personPct = bs.length ? Math.round(personCount / bs.length * 100) : 0;

const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t, bold: true })], spacing: { before: 360, after: 180 } });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t, bold: true })], spacing: { before: 240, after: 120 } });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: t, bold: true })], spacing: { before: 140, after: 70 } });
const P = (t, opts = {}) => new Paragraph({ children: [new TextRun({ text: String(t ?? ""), ...opts })], spacing: { after: 70 } });
const L = (lbl, val) => new Paragraph({ spacing: { after: 70 }, children: [new TextRun({ text: lbl, bold: true }), new TextRun({ text: String(val ?? "") })] });
const Div = () => new Paragraph({ spacing: { before: 50, after: 140 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC", space: 4 } }, children: [] });
const Br = () => new Paragraph({ children: [new PageBreak()] });

const c = [];
c.push(
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 400, after: 160 },
    children: [new TextRun({ text: "本轮生成题目", bold: true, size: 36 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 140 },
    children: [new TextRun({ text: `Session ${SESSION}`, italics: true, size: 22 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 },
    children: [new TextRun({ text: `BS ${bs.length} · 学术讨论 ${disc.length} · 邮件 ${email.length} · 阅读 ${ap.length + ctw.length + rdlShort.length + rdlLong.length}`, size: 22 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 320 },
    children: [new TextRun({ text: `BS 人物当 prefilled: ${personCount}/${bs.length} = ${personPct}% (真 TPO ~30%, 旧版 60%)`, size: 22, color: "1F6FEB" })] }),
);

// BS
if (bs.length) {
  c.push(H1(`造句 (Build a Sentence) — ${bs.length} 道`));
  bs.forEach((q, i) => {
    c.push(H3(`${i + 1}. ${q.id || ""}`));
    c.push(L("原题 prompt:  ", q.prompt));
    c.push(L("题目 chunks:  ", (q.chunks || []).join("  |  ")));
    const pf = (q.prefilled || []).length ? (q.prefilled || []).join(", ") : "(empty)";
    const isP = (q.prefilled || []).some((s) => isPersonPrefilled(s));
    c.push(L("Prefilled:    ", pf + (isP ? "  ← 人物" : "") + (Object.keys(q.prefilled_positions || {}).length ? `   pos: ${JSON.stringify(q.prefilled_positions)}` : "")));
    c.push(L("干扰词:        ", q.distractor || "(none)"));
    c.push(L("答案:          ", q.answer));
    if ((q.grammar_points || []).length) c.push(L("语法点:        ", q.grammar_points.join("; ")));
    c.push(Div());
  });
  c.push(Br());
}

// Discussion
if (disc.length) {
  c.push(H1(`学术讨论 — ${disc.length} 道`));
  disc.forEach((q, i) => {
    c.push(H2(`${i + 1}. ${q.course || ""}`));
    c.push(L("教授帖子:  ", ""));
    c.push(P(q?.professor?.text || ""));
    (q.students || []).forEach((s, si) => { c.push(L(`${s.name} (${si + 1}):  `, "")); c.push(P(s.text || "")); });
    c.push(Div());
  });
  c.push(Br());
}

// Email
if (email.length) {
  c.push(H1(`邮件写作 — ${email.length} 道`));
  email.forEach((q, i) => {
    c.push(H2(`${i + 1}. ${q.topic || ""}`));
    c.push(L("Scenario:   ", q.scenario || ""));
    c.push(L("Direction:  ", q.direction || ""));
    (q.goals || []).forEach((g, gi) => c.push(P(`  ${gi + 1}. ${g}`)));
    c.push(L("To:         ", q.to || ""));
    c.push(L("Subject:    ", q.subject || ""));
    c.push(Div());
  });
  c.push(Br());
}

// Reading AP
if (ap.length) {
  c.push(H1(`阅读 AP — ${ap.length} 道`));
  ap.forEach((q, i) => {
    c.push(H2(`${i + 1}. ${q.topic}/${q.subtopic}`));
    c.push(L("原文:  ", ""));
    (q.paragraphs || []).forEach((para, pi) => c.push(P(`§${pi + 1}: ${para}`)));
    c.push(L("题目:  ", ""));
    (q.questions || []).forEach((qq, qi) => {
      c.push(P(`Q${qi + 1} [${qq.question_type}]: ${qq.stem}`, { bold: true }));
      Object.keys(qq.options || {}).sort().forEach((k) => c.push(P(`  ${k}. ${qq.options[k]}`)));
      c.push(L("答案: ", `${qq.correct_answer} — ${qq.explanation || ""}`));
    });
    c.push(Div());
  });
  c.push(Br());
}

// Reading CTW
if (ctw.length) {
  c.push(H1(`阅读 CTW — ${ctw.length} 道`));
  ctw.forEach((q, i) => {
    c.push(H2(`${i + 1}. ${q.topic}/${q.subtopic}`));
    c.push(L("原文:  ", ""));
    c.push(P(q.passage || ""));
    c.push(L("挖空版:  ", ""));
    c.push(P(q.blanked_text || ""));
    c.push(L("答案:  ", ""));
    (q.blanks || []).forEach((b, bi) => c.push(P(`  ${bi + 1}. "${b.displayed_fragment}___" → ${b.original_word}`)));
    c.push(Div());
  });
  c.push(Br());
}

// RDL
for (const [label, list] of [["RDL-短", rdlShort], ["RDL-长", rdlLong]]) {
  if (!list.length) continue;
  c.push(H1(`阅读 ${label} — ${list.length} 道`));
  list.forEach((q, i) => {
    c.push(H2(`${i + 1}. ${q.genre}`));
    c.push(P(q.text || ""));
    (q.questions || []).forEach((qq, qi) => {
      c.push(P(`Q${qi + 1} [${qq.question_type}]: ${qq.stem}`, { bold: true }));
      Object.keys(qq.options || {}).sort().forEach((k) => c.push(P(`  ${k}. ${qq.options[k]}`)));
      c.push(L("答案: ", `${qq.correct_answer} — ${qq.explanation || ""}`));
    });
    c.push(Div());
  });
  c.push(Br());
}

const doc = new Document({
  creator: "Claude routine pipeline",
  title: `本轮生成题目 ${SESSION}`,
  styles: {
    default: { document: { run: { font: "Calibri", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 32, bold: true, color: "1F4E79" }, paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 27, bold: true, color: "2E75B6" }, paragraph: { spacing: { before: 240, after: 130 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 23, bold: true, color: "4F81BD" }, paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 2 } },
    ],
  },
  sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children: c }],
});

const out = process.argv[3] || `D:/桌面/本轮生成题目-${SESSION}.docx`;
Packer.toBuffer(doc).then((buf) => {
  writeFileSync(out, buf);
  console.log(`\n✅ wrote ${out} (${buf.length} bytes, ${c.length} paragraphs)`);
}).catch((e) => { console.error("ERROR:", e); process.exit(1); });
