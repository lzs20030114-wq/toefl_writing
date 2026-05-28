#!/usr/bin/env node
// Export today's qualified BS items + non-BS items to D-drive desktop as
// a single .docx for human review. Reads the cleaned bank state.

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, PageBreak } = require("docx");

const bs = JSON.parse(readFileSync(resolve(ROOT, "data/buildSentence/questions.json"), "utf8"));
const disc = JSON.parse(readFileSync(resolve(ROOT, "data/academicWriting/prompts.json"), "utf8"));
const email = JSON.parse(readFileSync(resolve(ROOT, "data/emailWriting/prompts.json"), "utf8"));
const ap = JSON.parse(readFileSync(resolve(ROOT, "data/reading/bank/ap.json"), "utf8")).items;
const ctw = JSON.parse(readFileSync(resolve(ROOT, "data/reading/bank/ctw.json"), "utf8")).items;
const rdlShort = JSON.parse(readFileSync(resolve(ROOT, "data/reading/bank/rdl-short.json"), "utf8")).items;
const rdlLong = JSON.parse(readFileSync(resolve(ROOT, "data/reading/bank/rdl-long.json"), "utf8")).items;
let reservePool = { items: [] };
try {
  const parsed = JSON.parse(readFileSync(resolve(ROOT, "data/buildSentence/reserve_pool.json"), "utf8"));
  reservePool = { items: Array.isArray(parsed?.items) ? parsed.items : (Array.isArray(parsed) ? parsed : []) };
} catch {}

// Today's items
const todaySessions = ["routine-20260528-061913", "routine-20260528-082414", "routine-20260528-165154", "routine-r2-20260528-171435", "routine-20260528-170909", "routine-20260528-170930"];

const todayBSSets = (bs.question_sets || []).filter((s) => s.set_id >= 70);
const todayBS = todayBSSets.flatMap((s) => s.questions.map((q) => ({ ...q, _set_id: s.set_id })));
const todayDisc = disc.filter((q) => Number(String(q.id || "").replace(/\D/g, "")) >= 161);
const todayEmail = email.filter((q) => Number(String(q.id || "").replace(/\D/g, "")) >= 95);
const todayAP = ap.filter((q) => todaySessions.some((s) => String(q.id).includes(s)));
const todayCTW = ctw.filter((q) => todaySessions.some((s) => String(q.id).includes(s)));
const todayRDLShort = rdlShort.filter((q) => todaySessions.some((s) => String(q.id).includes(s)));
const todayRDLLong = rdlLong.filter((q) => todaySessions.some((s) => String(q.id).includes(s)));

console.log("Exporting today's qualified items:");
console.log("  BS in bank:", todayBS.length, "(in sets " + todayBSSets.map((s) => s.set_id).join(",") + ")");
console.log("  BS reserve:", reservePool.items.length);
console.log("  Discussion:", todayDisc.length);
console.log("  Email:", todayEmail.length);
console.log("  AP:", todayAP.length, "| CTW:", todayCTW.length);
console.log("  RDL-short:", todayRDLShort.length, "| RDL-long:", todayRDLLong.length);

// Helpers
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t, bold: true })], spacing: { before: 360, after: 180 } });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t, bold: true })], spacing: { before: 240, after: 140 } });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: t, bold: true })], spacing: { before: 160, after: 80 } });
const P = (t, opts={}) => new Paragraph({ children: [new TextRun({ text: String(t ?? ""), ...opts })], spacing: { after: 80 } });
const L = (lbl, val) => new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: lbl, bold: true }), new TextRun({ text: String(val ?? "") })] });
const Div = () => new Paragraph({ spacing: { before: 60, after: 160 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC", space: 4 } }, children: [] });
const Br = () => new Paragraph({ children: [new PageBreak()] });

const c = [];

// Cover
c.push(
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 400, after: 200 },
    children: [new TextRun({ text: "合格题目审核包 — 2026-05-29 v2 (cleanup后)", bold: true, size: 36 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 },
    children: [new TextRun({ text: `BS ${todayBS.length} 道 (含 reserve ${reservePool.items.length})  ·  Discussion ${todayDisc.length}  ·  Email ${todayEmail.length}  ·  Reading ${todayAP.length + todayCTW.length + todayRDLShort.length + todayRDLLong.length}`, italics: true, size: 22 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 320 },
    children: [new TextRun({ text: "已删除 2 道废 (s71_q6 schema fail, s72_q3 topic mismatch),重新打包入 sets 70-76", size: 22, color: "1F6FEB" })] }),
);

// BS
c.push(H1(`造句 (Build a Sentence) — ${todayBS.length} 道,7 个 sets`));
c.push(P("以下所有 BS 题已通过 L1-L4 单题 audit。每题标注 prefilled 类型 + position 多样性。"));

for (const setId of todayBSSets.map((s) => s.set_id)) {
  const setItems = todayBSSets.find((s) => s.set_id === setId).questions;
  c.push(H2(`Set ${setId} (${setItems.length} 道)`));
  setItems.forEach((q, i) => {
    c.push(H3(`${setId}.${i + 1}  ${q.id}`));
    c.push(L("原题 prompt:  ", q.prompt));
    c.push(L("题目 chunks:  ", (q.chunks || []).join("  |  ")));
    const pf = (q.prefilled || []).length > 0 ? (q.prefilled || []).join(", ") : "(empty)";
    c.push(L("Prefilled:    ", pf + (Object.keys(q.prefilled_positions || {}).length ? "   pos: " + JSON.stringify(q.prefilled_positions) : "")));
    c.push(L("干扰词:        ", q.distractor || "(none)"));
    c.push(L("答案:          ", q.answer));
    if (Array.isArray(q.grammar_points) && q.grammar_points.length > 0) c.push(L("语法点:        ", q.grammar_points.join("; ")));
    c.push(Div());
  });
}

if (reservePool.items.length > 0) {
  c.push(H2(`Reserve pool — ${reservePool.items.length} 道 (待 future 打包)`));
  reservePool.items.forEach((q, i) => {
    c.push(H3(`R.${i + 1}  ${q.id}`));
    c.push(L("Prompt:  ", q.prompt));
    c.push(L("Answer:  ", q.answer));
    const pf = (q.prefilled || []).length > 0 ? (q.prefilled || []).join(", ") : "(empty)";
    c.push(L("Prefill: ", pf));
    c.push(Div());
  });
}

c.push(Br());

// Discussion
c.push(H1(`学术讨论 — ${todayDisc.length} 道`));
todayDisc.forEach((q, i) => {
  c.push(H2(`${i + 1}. ${q.course || ""} (${q.id})`));
  c.push(L("教授帖子:  ", ""));
  c.push(P(q?.professor?.text || ""));
  (q.students || []).forEach((s, si) => {
    c.push(L(`${s.name} (${si + 1}):  `, ""));
    c.push(P(s.text || ""));
  });
  c.push(Div());
});

c.push(Br());

// Email
c.push(H1(`邮件写作 — ${todayEmail.length} 道`));
todayEmail.forEach((q, i) => {
  c.push(H2(`${i + 1}. ${q.topic || ""} (${q.id})`));
  c.push(L("Scenario:   ", q.scenario || ""));
  c.push(L("Direction:  ", q.direction || ""));
  (q.goals || []).forEach((g, gi) => c.push(P(`  ${gi + 1}. ${g}`)));
  c.push(L("To:         ", q.to || ""));
  c.push(L("Subject:    ", q.subject || ""));
  c.push(Div());
});

c.push(Br());

// Reading AP
c.push(H1(`阅读 AP — ${todayAP.length} 道`));
todayAP.forEach((q, i) => {
  c.push(H2(`${i + 1}. ${q.topic}/${q.subtopic} (${q.id})`));
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

// Reading CTW
c.push(H1(`阅读 CTW — ${todayCTW.length} 道`));
todayCTW.forEach((q, i) => {
  c.push(H2(`${i + 1}. ${q.topic}/${q.subtopic} (${q.id})`));
  c.push(L("原文:  ", ""));
  c.push(P(q.passage || ""));
  c.push(L("挖空版:  ", ""));
  c.push(P(q.blanked_text || ""));
  c.push(L("答案:  ", ""));
  (q.blanks || []).forEach((b, bi) => c.push(P(`  ${bi + 1}. "${b.displayed_fragment}___" → ${b.original_word}`)));
  c.push(Div());
});

c.push(Br());

// RDL-short
c.push(H1(`阅读 RDL-短 — ${todayRDLShort.length} 道`));
todayRDLShort.forEach((q, i) => {
  c.push(H2(`${i + 1}. ${q.genre} (${q.id})`));
  c.push(P(q.text || ""));
  (q.questions || []).forEach((qq, qi) => {
    c.push(P(`Q${qi + 1} [${qq.question_type}]: ${qq.stem}`, { bold: true }));
    Object.keys(qq.options || {}).sort().forEach((k) => c.push(P(`  ${k}. ${qq.options[k]}`)));
    c.push(L("答案: ", `${qq.correct_answer} — ${qq.explanation || ""}`));
  });
  c.push(Div());
});

c.push(Br());

// RDL-long
c.push(H1(`阅读 RDL-长 — ${todayRDLLong.length} 道`));
todayRDLLong.forEach((q, i) => {
  c.push(H2(`${i + 1}. ${q.genre} (${q.id})`));
  c.push(P(q.text || ""));
  (q.questions || []).forEach((qq, qi) => {
    c.push(P(`Q${qi + 1} [${qq.question_type}]: ${qq.stem}`, { bold: true }));
    Object.keys(qq.options || {}).sort().forEach((k) => c.push(P(`  ${k}. ${qq.options[k]}`)));
    c.push(L("答案: ", `${qq.correct_answer} — ${qq.explanation || ""}`));
  });
  c.push(Div());
});

const doc = new Document({
  creator: "Claude routine pipeline review",
  title: "合格题目审核包 v2 (2026-05-29)",
  styles: {
    default: { document: { run: { font: "Calibri", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 32, bold: true, color: "1F4E79" }, paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 28, bold: true, color: "2E75B6" }, paragraph: { spacing: { before: 240, after: 140 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 24, bold: true, color: "4F81BD" }, paragraph: { spacing: { before: 180, after: 100 }, outlineLevel: 2 } },
    ],
  },
  sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children: c }],
});

const out = process.argv[2] || "C:/Users/35827/Desktop/qualified-batch-2026-05-29-v2.docx";
Packer.toBuffer(doc).then((buf) => {
  writeFileSync(out, buf);
  console.log(`\n✅ wrote ${out} (${buf.length} bytes, ${c.length} paragraphs)`);
}).catch((e) => { console.error("ERROR:", e); process.exit(1); });
