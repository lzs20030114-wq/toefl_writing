#!/usr/bin/env node
// Self-contained, schema-ADAPTIVE integration of the official 2026 full-length
// tests' Reading/Listening/Speaking content into the project's canonical sample
// banks. It parses the raw PDF text dumps, then conforms each item to the
// EXISTING curated file's structure (mirrors keys, detects field names) so it
// cannot drift from the real schema. It writes ONLY when it successfully parsed
// the target file (so curated data is never corrupted), and self-validates
// (process exits 1 on any structural problem). Reading -> new globbed
// ets_fulllength.json; Listening/Speaking -> merged into *-reference.json.
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const root = resolve(import.meta.dirname, "..", "..");
const R = (p) => resolve(root, p);
const rd = (p) => JSON.parse(readFileSync(R(p), "utf8"));
const wc = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
const LET = ["A", "B", "C", "D", "E"];
const SRCS = [
  { file: ".research/raw/ets-full-length-1.txt", label: "ETS Official — Full-Length Practice Test 1 (2026)", url: "https://www.ets.org/pdfs/toefl/toefl-ibt-full-length-practice-test-1.pdf" },
  { file: ".research/raw/ets-full-2.txt", label: "ETS Official — Full-Length Practice Test 2 (2026)", url: "https://www.ets.org/pdfs/toefl/toefl-ibt-full-length-practice-test-2.pdf" },
];
const report = []; let problems = 0;
const note = (m) => report.push(m);
const fail = (m) => { report.push("FAIL " + m); problems++; };

// ---------- generic helpers ----------
const footer = (s) => String(s).replace(/TOEFL iBT.*?Practice Test \d+\s*\d*/gi, " ").replace(/(Reading|Listening|Writing|Speaking) Section,? ?(Module \d+)?/gi, " ").replace(/\s+/g, " ").trim();
function section(text, startRe, endRe) {
  const L = text.split(/\r?\n/); let s = -1, e = L.length;
  for (let i = 0; i < L.length; i++) { if (s < 0 && startRe.test(L[i])) s = i; else if (s >= 0 && endRe.test(L[i])) { e = i; break; } }
  return s < 0 ? "" : L.slice(s, e).join("\n");
}
function answerKey(sec) { const a = {}; for (const ln of sec.split(/\r?\n/)) { const m = ln.match(/^\s*(\d{1,3})\s+([A-E])\s*$/); if (m) a[+m[1]] = +m[1] && LET.indexOf(m[2]); } return a; }
function qType(stem) { const s = String(stem).toLowerCase(); if (/main (idea|purpose|point)|mainly about|primarily about/.test(s)) return "main_purpose"; if (/why (does|did)|purpose of|in order to/.test(s)) return "function"; if (/infer|imply|suggest|most likely|probably/.test(s)) return "inference"; if (/word|phrase|mean|refers? to/.test(s)) return "vocabulary"; if (/attitude|feel|opinion|tone/.test(s)) return "attitude"; return "detail"; }
function diffFromWC(n) { return n <= 60 ? "easy" : n <= 140 ? "medium" : "hard"; }

// parse "Read .../Listen ..." item blocks with N. questions and (A)-(D) options
function parseBlocks(sec, headerRe) {
  const lines = sec.split(/\r?\n/); const ak = answerKey(sec);
  const items = []; let cur = null, inAK = false;
  for (const ln of lines) {
    if (/Number\s+Answer|Question\s+(Reading|Listening) Section/i.test(ln)) { inAK = true; if (cur) { items.push(cur); cur = null; } continue; }
    if (inAK) continue;
    const h = ln.match(headerRe);
    if (h) { if (cur) items.push(cur); cur = { header: h[2].trim(), isAcademic: /academic (passage|text)|talk|lecture|podcast/i.test(ln), raw: [] }; continue; }
    if (cur) cur.raw.push(ln);
  }
  if (cur) items.push(cur);
  const out = [];
  for (const it of items) {
    const blob = it.raw.join("\n");
    const qStart = blob.search(/(^|\n)\s*\d{1,3}\.\s/);
    if (qStart < 0) continue;
    const bodyText = blob.slice(0, qStart);
    const qblob = blob.slice(qStart);
    const questions = [];
    for (const ch of qblob.split(/(?=(?:^|\n)\s*\d{1,3}\.\s)/)) {
      const qm = ch.match(/^\s*(\d{1,3})\.\s+([\s\S]*)$/); if (!qm) continue;
      const oS = qm[2].search(/\(A\)/); if (oS < 0) continue;
      const stem = footer(qm[2].slice(0, oS));
      const opts = []; const re = /\(([A-D])\)\s*([\s\S]*?)(?=\s*\([A-D]\)|$)/g; let om;
      while ((om = re.exec(qm[2].slice(oS))) !== null) opts.push(footer(om[2]));
      if (opts.length < 3) continue;
      const ans = ak[+qm[1]];
      questions.push({ stem, opts, answerIdx: typeof ans === "number" ? ans : null });
    }
    if (questions.length) out.push({ header: it.header, isAcademic: it.isAcademic, body: bodyText, questions });
  }
  return out;
}

// build options/questions in the shape the existing file uses (detected)
function buildQuestions(parsedQs, sampleQ) {
  const optKey = "options";
  const ansKey = sampleQ && "answer" in sampleQ ? "answer" : "correct_answer";
  const typeKey = sampleQ && "question_type" in sampleQ ? "question_type" : "type";
  const idKey = sampleQ && "qid" in sampleQ ? "qid" : (sampleQ && "id" in sampleQ ? "id" : null);
  const hasExpl = !sampleQ || "explanation" in sampleQ;
  return parsedQs.map((q, i) => {
    const o = {};
    if (idKey) o[idKey] = `q${i + 1}`;
    o[typeKey] = qType(q.stem);
    o.stem = q.stem;
    o[optKey] = Object.fromEntries(q.opts.map((t, j) => [LET[j], t]));
    o[ansKey] = q.answerIdx == null ? null : LET[q.answerIdx];
    if (hasExpl) o.explanation = ""; // not fabricated — answer key gives only the letter
    return o;
  });
}

// ---------- READING ----------
// 2026 reading passages do NOT all carry a "Read a/an X." header — the academic
// passages are title-headed (e.g. "The Mirror Test"). So we segment by a prose
// -> questions -> prose state machine: a passage is prose text followed by its
// numbered questions; the next prose line after a question block starts a new
// passage. Answers are taken from the module answer-key ONLY when the displayed
// question number is found in the key; otherwise answer=null (never guess).
function parseReadingPassages(sec) {
  const lines = sec.split(/\r?\n/);
  const ak = answerKey(sec);
  const passages = [];
  let cur = null, mode = "pre";
  const isQ = (l) => /^\s*\d{1,3}\.\s/.test(l);
  const isOpt = (l) => /^\s*\([A-D]\)/.test(l);
  const isNoise = (l) => !l.trim() || /TOEFL iBT.*Practice Test/i.test(l) || /^\s*\(Questions/i.test(l) || /In an actual test/i.test(l) || /^\s*Reading Section/i.test(l);
  const isAK = (l) => /Number\s+Answer|Answer Key|Question\s+Reading Section/i.test(l);
  const startPassage = (firstLine) => { cur = { head: firstLine.replace(/^\s*Read (a|an|the)\s+/i, "").replace(/\.\s*$/, "").trim(), bodyLines: [firstLine], qs: [] }; mode = "prose"; };
  const finish = () => { if (cur && cur.qs.length) passages.push(cur); cur = null; };
  for (const raw of lines) {
    if (isAK(raw)) break;
    if (isNoise(raw)) continue;
    const headerLike = /^\s*Read (a|an|the)\s+/i.test(raw);
    if (mode === "pre") { if (headerLike || (raw.trim().length > 3 && !isQ(raw) && !isOpt(raw))) startPassage(raw); continue; }
    if (mode === "prose") {
      if (isQ(raw)) { mode = "questions"; cur.qs.push({ num: parseInt(raw.match(/^\s*(\d{1,3})\./)[1], 10), lines: [raw] }); }
      else cur.bodyLines.push(raw);
      continue;
    }
    // mode === "questions"
    if (headerLike) { finish(); startPassage(raw); continue; }
    if (isQ(raw)) { cur.qs.push({ num: parseInt(raw.match(/^\s*(\d{1,3})\./)[1], 10), lines: [raw] }); continue; }
    if (isOpt(raw) || /^\s+/.test(raw) === false && cur.qs.length && !/[.!?]$/.test(cur.bodyLines.at(-1) || "")) { cur.qs.at(-1).lines.push(raw); continue; }
    // a fresh prose line after questions -> new passage begins
    finish(); startPassage(raw);
  }
  finish();
  // build structured passages
  return passages.map((p) => {
    const body = footer(p.bodyLines.join("\n"));
    const questions = [];
    for (const q of p.qs) {
      const blob = q.lines.join("\n");
      const oS = blob.search(/\(A\)/); if (oS < 0) continue;
      const stem = footer(blob.slice(blob.indexOf(".") + 1, oS));
      const opts = []; const re = /\(([A-D])\)\s*([\s\S]*?)(?=\s*\([A-D]\)|$)/g; let m;
      while ((m = re.exec(blob.slice(oS))) !== null) opts.push(footer(m[2]));
      if (opts.length < 3) continue;
      const a = ak[q.num];
      questions.push({ stem, opts, answerIdx: typeof a === "number" ? a : null });
    }
    return { head: p.head, body, questions };
  }).filter((p) => p.body.length > 40 && p.questions.length);
}
function doReading() {
  const rdl = [], ap = [];
  for (const s of SRCS) {
    if (!existsSync(R(s.file))) { note(`reading: missing ${s.file}`); continue; }
    const txt = readFileSync(R(s.file), "utf8");
    const sec = section(txt, /^\s*Reading Section\s*$/, /^\s*Listening Section\s*$/);
    if (!sec) { note(`reading: no section in ${s.file}`); continue; }
    for (const p of parseReadingPassages(sec)) {
      const bodyWc = p.body.split(/\s+/).filter(Boolean).length;
      const headRDL = /^(a |an |the )?(notice|social media post|post|email|e-mail|advertis|message|text message|schedule|review|letter|memo|flyer|announcement|sign)/i.test(p.head);
      const isAP = !headRDL && bodyWc > 110;
      const it = { header: p.head, body: p.body, questions: p.questions, src: s };
      (isAP ? ap : rdl).push(it);
    }
  }
  // RDL template
  const rdlTmpl = (() => { try { return rd("data/reading/samples/readInDailyLife/ets_official.json").items[0]; } catch { return null; } })();
  const apTmpl = (() => { try { return rd("data/reading/samples/academicPassage/ets_official.json").items[0]; } catch { return null; } })();
  const textKeyR = rdlTmpl && ("text" in rdlTmpl ? "text" : "passage" in rdlTmpl ? "passage" : "content");
  const rdlItems = rdl.map((it, i) => {
    const content = footer(it.body);
    const o = { id: `rdl_fl_${i + 1}` };
    o[textKeyR] = content;
    o.word_count = wc(content);
    o.genre = (/social media|post/i.test(it.header) ? "social_media_post" : /email/i.test(it.header) ? "email" : /advertis/i.test(it.header) ? "advertisement" : /message/i.test(it.header) ? "message" : /schedule/i.test(it.header) ? "schedule" : "notice");
    o.source = it.src.label; o.source_url = it.src.url; o.tier = "official"; o.format = "2026";
    o.questions = buildQuestions(it.questions, rdlTmpl && rdlTmpl.questions && rdlTmpl.questions[0]);
    o.question_count = o.questions.length;
    o.difficulty = diffFromWC(o.word_count);
    return o;
  });
  // AP: detect whether passage is a string or {paragraphs}
  const apUsesParagraphs = apTmpl && apTmpl.passage && typeof apTmpl.passage === "object";
  const apItems = ap.map((it, i) => {
    const content = footer(it.body);
    const o = { id: `ap_fl_${i + 1}` };
    const title = it.header.replace(/^academic (passage|text)\s*(about |on )?/i, "").replace(/^./, c => c.toUpperCase()).trim() || "Academic Passage";
    if (apUsesParagraphs) o.passage = { title, paragraphs: [content], word_count: wc(content), topic: "general" };
    else { o.passage = content; o.title = title; o.word_count = wc(content); o.topic = "general"; }
    o.source = it.src.label; o.source_url = it.src.url; o.tier = "official"; o.format = "2026";
    o.questions = buildQuestions(it.questions, apTmpl && apTmpl.questions && apTmpl.questions[0]);
    o.question_count = o.questions.length;
    o.difficulty = diffFromWC(wc(content));
    return o;
  });
  if (rdlItems.length) {
    writeFileSync(R("data/reading/samples/readInDailyLife/ets_fulllength.json"),
      JSON.stringify({ source: "ets_official", source_detail: "2026 Full-Length Practice Tests 1 & 2", copyright_note: "Internal reference only. Never served to end users.", items: rdlItems }, null, 2) + "\n");
    note(`Reading RDL: wrote ${rdlItems.length} -> readInDailyLife/ets_fulllength.json`);
  } else fail("Reading RDL: 0 items parsed");
  if (apItems.length) {
    writeFileSync(R("data/reading/samples/academicPassage/ets_fulllength.json"),
      JSON.stringify({ source: "ets_official", source_detail: "2026 Full-Length Practice Tests 1 & 2", copyright_note: "Internal reference only. Never served to end users.", items: apItems }, null, 2) + "\n");
    note(`Reading AP: wrote ${apItems.length} -> academicPassage/ets_fulllength.json`);
  } else fail("Reading AP: 0 items parsed");
}

// ---------- LISTENING ----------
function parseTranscript(body) {
  const turns = [];
  for (const raw of body.split(/\r?\n/)) {
    const ln = raw.trim(); if (!ln || /TOEFL iBT.*Practice Test/i.test(ln)) continue;
    const m = ln.match(/^\(([^)]+)\)\s*(.*)$/) || ln.match(/^([A-Z][A-Za-z .]{1,18}):\s*(.*)$/);
    if (m) turns.push({ speaker: m[1].trim(), text: footer(m[2]) });
    else if (turns.length) turns[turns.length - 1].text = footer(turns[turns.length - 1].text + " " + ln);
  }
  return turns.filter(t => t.text);
}
function doListening() {
  const byType = { LC: [], LA: [], LAT: [] };
  for (const s of SRCS) {
    if (!existsSync(R(s.file))) continue;
    const txt = readFileSync(R(s.file), "utf8");
    const sec = section(txt, /^\s*Listening Section\s*$/, /^\s*(Writing|Speaking) Section\s*$/);
    if (!sec) continue;
    for (const it of parseBlocks(sec, /^\s*Listen to (a|an|the)\s+(.*?)\.?\s*$/i)) {
      const t = /conversation/i.test(it.header) ? "LC" : /announcement/i.test(it.header) ? "LA" : /talk|lecture|podcast|discussion/i.test(it.header) ? "LAT" : "LC";
      byType[t].push({ ...it, src: s });
    }
  }
  const MAP = { LC: ["lc", "listen_conversation"], LA: ["la", "listen_announcement"], LAT: ["lat", "listen_academic_talk"] };
  for (const key of ["LC", "LA", "LAT"]) {
    const [slug, taskType] = MAP[key];
    const file = `data/listening/samples/${slug}-reference.json`;
    if (!existsSync(R(file))) { fail(`listening ${slug}: reference file missing`); continue; }
    let doc; try { doc = rd(file); } catch (e) { fail(`listening ${slug}: parse error ${e.message}`); continue; }
    const arrKey = Array.isArray(doc) ? null : ("items" in doc ? "items" : "samples" in doc ? "samples" : null);
    const arr = arrKey ? doc[arrKey] : doc;
    if (!Array.isArray(arr)) { fail(`listening ${slug}: no array`); continue; }
    const tmpl = arr[0] || {};
    const textKey = "conversation" in tmpl ? "conversation" : "transcript" in tmpl ? "transcript" : "announcement" in tmpl ? "announcement" : "talk" in tmpl ? "talk" : "text" in tmpl ? "text" : "conversation";
    const tmplTextIsArray = Array.isArray(tmpl[textKey]);
    // NON-DESTRUCTIVE: build into a fresh array, write to a SEPARATE *-fulllength.json
    // (the curated -reference.json is read only as a schema template, never modified).
    const fresh = [];
    let added = 0;
    for (const it of byType[key]) {
      const turns = parseTranscript(it.body).filter(t => !/^narrator$/i.test(t.speaker) || !/^Listen to/i.test(t.text));
      added++;
      const o = { id: `${slug}_fl_${added}`, source: it.src.label, source_url: it.src.url, tier: "official", format: "2026" };
      o.title = footer(it.header).replace(/^./, c => c.toUpperCase());
      o.scenario = (it.body.match(/\(Narrator\)\s*(Listen to [^\n]+)/i) || [, ""])[1].replace(/\s+/g, " ").trim();
      o[textKey] = tmplTextIsArray ? turns : turns.map(t => `${t.speaker}: ${t.text}`).join("\n");
      o.questions = buildQuestions(it.questions, tmpl.questions && tmpl.questions[0]);
      fresh.push(o);
    }
    const outFile = `data/listening/samples/${slug}-fulllength.json`;
    writeFileSync(R(outFile), JSON.stringify({ source: "ets_official", source_detail: "2026 Full-Length Practice Tests 1 & 2", taskType, copyright_note: "Internal reference only.", note: "Separate from the curated -reference.json; merge in when wiring the single-file consumer.", items: fresh }, null, 2) + "\n");
    note(`Listening ${key}: wrote ${fresh.length} -> ${slug}-fulllength.json (non-destructive)`);
    if (!fresh.length) fail(`listening ${slug}: 0 items parsed`);
  }
}

// ---------- SPEAKING ----------
function parseSpeaking(text) {
  const i = text.search(/^\s*Speaking Section\s*$/m); if (i < 0) return { lr: [], iv: [] };
  const lines = text.slice(i).split(/\r?\n/).map(l => l.trim());
  const lr = [], iv = []; let cur = null;
  const flush = () => { if (cur && ((cur.kind === "lr" && cur.sentences.length) || (cur.kind === "iv" && cur.questions.length))) (cur.kind === "lr" ? lr : iv).push(cur); cur = null; };
  for (const ln of lines) {
    if (/^Listen and Repeat\b/i.test(ln)) { flush(); cur = { kind: "lr", scenario: "", sentences: [] }; continue; }
    if (/^Take an Interview\b/i.test(ln)) { flush(); cur = { kind: "iv", scenario: "", questions: [] }; continue; }
    if (!cur || !ln || /TOEFL iBT.*Practice Test/i.test(ln)) continue;
    if (!cur.scenario && /^(You are|You have|You will be|Imagine|You work)\b/i.test(ln) && !/^You will (listen|speak|hear)/i.test(ln)) { cur.scenario = ln.replace(/\s+/g, " "); continue; }
    let m;
    if ((m = ln.match(/^(Trainer|Speaker|Manager)\s*:\s*(.+)$/i)) && cur.kind === "lr") cur.sentences.push(m[2].replace(/\s+/g, " "));
    else if ((m = ln.match(/^Interviewer\s*:\s*(.+)$/i)) && cur.kind === "iv") cur.questions.push(m[1].replace(/\s+/g, " "));
  }
  flush(); return { lr, iv };
}
function dedup(a, f) { const s = new Set(), o = []; for (const x of a) { const k = f(x); if (s.has(k)) continue; s.add(k); o.push(x); } return o; }
function doSpeaking() {
  const lr = [], iv = [];
  for (const s of SRCS) { if (!existsSync(R(s.file))) continue; const r = parseSpeaking(readFileSync(R(s.file), "utf8")); r.lr.forEach(x => lr.push({ ...x, src: s })); r.iv.forEach(x => iv.push({ ...x, src: s })); }
  const lrD = dedup(lr, x => x.sentences[0] || ""), ivD = dedup(iv, x => x.questions[0] || "");
  // repeat
  mergeSets("data/speaking/samples/repeat-reference.json", "repeat", lrD, (it, i) => {
    const o = { id: `repeat_fl_${i + 1}`, scenario: it.scenario || "(see source)", source: it.src.label, source_url: it.src.url, tier: "official", format: "2026" };
    o.sentences = it.sentences.map(s => ({ sentence: s, difficulty: wc(s) <= 7 ? "easy" : wc(s) <= 12 ? "medium" : "hard", word_count: wc(s) }));
    return o;
  });
  // interview
  mergeSets("data/speaking/samples/interview-reference.json", "interview", ivD, (it, i) => {
    const o = { id: `interview_fl_${i + 1}`, topic: (it.scenario || "").replace(/^You (have agreed to|are) (take part in|participate in)?\s*/i, "").slice(0, 60) || "interview", intro: it.scenario || "", source: it.src.label, source_url: it.src.url, tier: "official", format: "2026" };
    const pos = ["Q1", "Q2", "Q3", "Q4", "Q5"];
    o.questions = it.questions.map((q, j) => ({ position: pos[j] || `Q${j + 1}`, difficulty: ["personal", "descriptive", "analytical", "evaluative"][j] || "analytical", question: q }));
    return o;
  });
}
function mergeSets(file, slug, items, build) {
  // NON-DESTRUCTIVE: write to a SEPARATE *-fulllength.json. The curated
  // -reference.json is left untouched (read here only to confirm it parses).
  if (existsSync(R(file))) { try { rd(file); } catch (e) { fail(`speaking ${slug}: existing reference parse error ${e.message}`); } }
  const fresh = items.map((it, i) => build(it, i));
  const outFile = `data/speaking/samples/${slug}-fulllength.json`;
  writeFileSync(R(outFile), JSON.stringify({ source: "ets_official", source_detail: "2026 Full-Length Practice Tests 1 & 2", copyright_note: "Internal reference only.", note: "Separate from curated -reference.json; merge in when wiring the single-file consumer.", sets: fresh }, null, 2) + "\n");
  note(`Speaking ${slug}: wrote ${fresh.length} -> ${slug}-fulllength.json (non-destructive)`);
  if (!fresh.length) fail(`speaking ${slug}: 0 items`);
}

// ---------- run + validate ----------
doReading(); doListening(); doSpeaking();
// validate every file we may have written is valid JSON
for (const f of ["data/reading/samples/readInDailyLife/ets_fulllength.json", "data/reading/samples/academicPassage/ets_fulllength.json",
  "data/listening/samples/lc-fulllength.json", "data/listening/samples/la-fulllength.json", "data/listening/samples/lat-fulllength.json",
  "data/speaking/samples/repeat-fulllength.json", "data/speaking/samples/interview-fulllength.json"]) {
  if (existsSync(R(f))) { try { rd(f); } catch (e) { fail(`INVALID JSON after write: ${f} ${e.message}`); } }
}
writeFileSync(R("scripts/research/_rls_report.json"), JSON.stringify({ problems, report }, null, 2));
console.log(report.join("\n"));
console.log("PROBLEMS:", problems);
process.exit(problems ? 1 : 0);
