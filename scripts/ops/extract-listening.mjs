#!/usr/bin/env node
// Extract structured listening items from the 14 text-layer transcripts.
// Source: .codex-tmp/exam_txt/*原文*.txt (pdftotext output). Zero OCR.
// Output: data/realExam2026/listening/{conversations,announcements,lectures,shortResponse}.json
// All items tier="recalled", with origin set + date.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = resolve(ROOT, ".codex-tmp/exam_txt");
const OUTDIR = resolve(ROOT, "data/realExam2026/listening");
mkdirSync(OUTDIR, { recursive: true });

const MARKER = /^(Conversation|Announcement|Lecture|Discussion)\s*(\d+)\s*$/i;
const TYPE_MAP = { conversation: "lc", announcement: "la", lecture: "lat", discussion: "lat" };
const STEM = /^\s*(\d+)\s*[\.\)]\s*(.+)$/;

function setDate(setName, firstLine) {
  // always derive from the set folder name, zero-padded, for a consistent
  // "2026-MM-DD" id format across every extractor (text + audio + OCR).
  const mm = String(setName).match(/(\d{1,2})\.(\d{1,2})/);
  return mm ? `2026-${mm[1].padStart(2, "0")}-${mm[2].padStart(2, "0")}` : "2026";
}

// Split a passage's raw text into transcript prose + framing, and parse speakers.
function parsePassage(lines) {
  // lines: prose lines (no question stems). Join, then split on speaker labels.
  let text = lines.join(" ").replace(/\s+/g, " ").trim();
  // strip leading framing "Listen to a conversation." / "Listen to a talk in a physics class."
  const framing = text.match(/^Listen to [^.]*\.\s*/i);
  let setting = "";
  if (framing) { setting = framing[0].trim(); text = text.slice(framing[0].length).trim(); }
  // parse speaker turns: "Man: ... Woman: ... Name: ..."
  const turns = [];
  const re = /(?:^|\s)([A-Z][a-zA-Z]{1,14}):\s*/g;
  let m, last = null, lastIdx = 0;
  const marks = [];
  while ((m = re.exec(text)) !== null) marks.push({ name: m[1], start: m.index + m[0].length - m[1].length - 2, contentStart: m.index + m[0].length });
  if (marks.length) {
    for (let i = 0; i < marks.length; i++) {
      const seg = text.slice(marks[i].contentStart, i + 1 < marks.length ? marks[i + 1].start : text.length).trim();
      if (seg) turns.push({ speaker: marks[i].name, text: seg });
    }
  }
  // audio framing ("Listen to a conversation.") sometimes lands as the first
  // speaker turn — lift it into `setting` and drop/trim that turn.
  if (turns.length && /^listen to .{0,70}?\.\s*/i.test(turns[0].text)) {
    const fm = turns[0].text.match(/^(Listen to .{0,70}?\.)\s*([\s\S]*)$/i);
    if (fm) {
      if (!setting) setting = fm[1];
      if (fm[2].trim()) turns[0].text = fm[2].trim();
      else turns.shift();
    }
  }
  return { setting, fullText: text, turns };
}

function parseTranscript(file) {
  const raw = readFileSync(resolve(SRC, file), "utf8").replace(/\r/g, "");
  const allLines = raw.split("\n");
  const setName = file.split("__")[0];
  const date = setDate(setName, allLines[0]);
  const items = { lc: [], la: [], lat: [], short: [] };

  // split into modules
  const modIdx = [];
  allLines.forEach((l, i) => { if (/^Module\s*\d/i.test(l.trim())) modIdx.push(i); });
  if (!modIdx.length) modIdx.push(0);
  modIdx.push(allLines.length);

  for (let mi = 0; mi < modIdx.length - 1; mi++) {
    const module = mi + 1;
    const block = allLines.slice(modIdx[mi], modIdx[mi + 1]);
    // find passage marker positions within this module
    const markerPos = [];
    block.forEach((l, i) => { const mm = l.trim().match(MARKER); if (mm) markerPos.push({ i, kind: mm[1].toLowerCase(), num: mm[2] }); });

    // short-response block: between "Choose the best response." and first marker
    const crIdx = block.findIndex((l) => /choose the best response/i.test(l));
    const firstMarker = markerPos.length ? markerPos[0].i : block.length;
    if (crIdx >= 0) {
      const shortItems = [];
      for (let i = crIdx + 1; i < firstMarker; i++) {
        const s = block[i].match(STEM);
        if (s) shortItems.push(s[2].trim());
      }
      if (shortItems.length) items.short.push({
        id: `${date}_m${module}_short`, source: setName, date, tier: "recalled",
        type: "shortResponse", module, prompts: shortItems,
      });
    }

    // passages
    for (let p = 0; p < markerPos.length; p++) {
      const start = markerPos[p].i + 1;
      const end = p + 1 < markerPos.length ? markerPos[p + 1].i : block.length;
      const seg = block.slice(start, end);
      const prose = [], questions = [];
      for (const l of seg) {
        const s = l.match(STEM);
        if (s) questions.push(s[2].trim()); else if (l.trim()) prose.push(l.trim());
      }
      if (!prose.length) continue;
      const kind = markerPos[p].kind;
      const t = TYPE_MAP[kind] || "lat";
      const parsed = parsePassage(prose);
      const item = {
        id: `${date}_m${module}_${kind}${markerPos[p].num}`, source: setName, date, tier: "recalled",
        type: t, subtype: kind, module,
        setting: parsed.setting,
        questions,
      };
      if (t === "lc") item.conversation = parsed.turns.length ? parsed.turns : [{ speaker: "", text: parsed.fullText }];
      else item.transcript = parsed.fullText;
      items[t].push(item);
    }
  }
  return items;
}

const files = readdirSync(SRC).filter((f) => /原文/.test(f) && f.endsWith(".txt"));
const all = { lc: [], la: [], lat: [], short: [] };
for (const f of files) {
  const it = parseTranscript(f);
  for (const k of Object.keys(all)) all[k].push(...it[k]);
}

const meta = (arr, title) => ({ title, tier: "recalled", source: "2026改后机经 (闲鱼)", count: arr.length, items: arr });
writeFileSync(resolve(OUTDIR, "conversations.json"), JSON.stringify(meta(all.lc, "LC — Listen to a Conversation (recalled 2026)"), null, 2));
writeFileSync(resolve(OUTDIR, "announcements.json"), JSON.stringify(meta(all.la, "LA — Listen to an Announcement (recalled 2026)"), null, 2));
writeFileSync(resolve(OUTDIR, "lectures.json"), JSON.stringify(meta(all.lat, "LAT — Listen to a Talk/Lecture (recalled 2026)"), null, 2));
writeFileSync(resolve(OUTDIR, "shortResponse.json"), JSON.stringify(meta(all.short, "Short-response prompts (recalled 2026)"), null, 2));

console.log(`transcripts: ${files.length}`);
console.log(`conversations(lc): ${all.lc.length}`);
console.log(`announcements(la): ${all.la.length}`);
console.log(`lectures(lat): ${all.lat.length}`);
console.log(`short-response blocks: ${all.short.length} (${all.short.reduce((a, x) => a + x.prompts.length, 0)} prompts)`);
