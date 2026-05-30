#!/usr/bin/env node
// Parse cached examword discussion-example HTML pages (.research/raw/ew-<p>.html)
// into structured Academic Discussion items. Verbatim from source — no
// transcription. Each page: an "ivory" box holding
//   "The professor is teaching a class on <COURSE>. Write a post..."
//   "Professor:<post><br/>" then "<Name>:<post>" for each student.
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const root = resolve(import.meta.dirname, "..", "..");
const rawDir = resolve(root, ".research/raw");

// dates known from the listing page (latest 20); others null
const DATES = {
  1518: "2026-05-18", 1517: "2026-05-17", 1516: "2026-05-16", 1514: "2026-05-16",
  1515: "2026-04-23", 1543: "2026-04-12", 1542: "2026-04-11", 1541: "2026-04-10",
  1540: "2026-04-09", 1539: "2026-04-07", 1538: "2026-04-06", 1537: "2026-04-05",
  1536: "2026-04-05", 1535: "2026-04-04", 1534: "2026-04-03", 1533: "2026-04-02",
  1532: "2026-04-01", 1531: "2026-03-31", 1530: "2026-03-30", 1529: "2026-03-29",
};

function decode(s) {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"').replace(/&nbsp;/g, " ")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/—/g, "—").replace(/–/g, "—");
}

function parsePage(html) {
  // grab the ivory content box
  const m = html.match(/background-color:ivory[^>]*>([\s\S]*?)<\/div>/i);
  if (!m) return null;
  let text = decode(m[1]);
  // course
  const cm = text.match(/teaching a class (?:on|in)\s+([^.]+?)\.\s/i);
  const course = cm ? cm[1].trim().toLowerCase() : "social studies";
  // strip the directions preamble: everything up to and including the
  // "...at least 100 words." line; speakers follow.
  const dirIdx = text.search(/Professor\s*:/i);
  if (dirIdx < 0) return null;
  const body = text.slice(dirIdx);
  // split into speaker:post segments. Speakers are "Professor" or a Capitalized name.
  const parts = [];
  const re = /(^|\n)\s*([A-Z][a-zA-Z.'-]{1,20})\s*:\s*/g;
  let mm, segs = [];
  while ((mm = re.exec(body)) !== null) segs.push({ name: mm[2], start: mm.index + mm[0].length, headStart: mm.index });
  for (let i = 0; i < segs.length; i++) {
    const end = i + 1 < segs.length ? segs[i + 1].headStart : body.length;
    const post = body.slice(segs[i].start, end).replace(/\s+/g, " ").trim();
    if (post.length > 20) parts.push({ name: segs[i].name, text: post });
  }
  if (parts.length < 3) return null; // need professor + 2 students
  const prof = parts.find((p) => /^professor$/i.test(p.name)) || parts[0];
  const students = parts.filter((p) => p !== prof).slice(0, 2);
  return {
    course,
    professor: { name: "Professor", text: prof.text },
    students: students.map((s) => ({ name: s.name, text: s.text })),
  };
}

const items = [];
const fails = [];
for (let p = 1500; p <= 1543; p++) {
  const f = resolve(rawDir, `ew-${p}.html`);
  if (!existsSync(f)) { fails.push(`${p}:missing`); continue; }
  const html = readFileSync(f, "utf8");
  const parsed = parsePage(html);
  if (!parsed) { fails.push(`${p}:parsefail`); continue; }
  items.push({
    ...parsed,
    _source: `https://www.examword.com/writing/discussion-example?p=${p}`,
    _date: DATES[p] || null,
    _tier: "recalled",
  });
}

writeFileSync(resolve(root, ".research/collected/ad_recalled_raw.json"), JSON.stringify(items, null, 2));
console.log(`Parsed ${items.length} items. Fails: ${fails.length ? fails.join(", ") : "none"}`);
const courses = {};
for (const it of items) courses[it.course] = (courses[it.course] || 0) + 1;
console.log("Courses:", courses);
// sanity: show a couple
for (const it of items.slice(0, 2)) {
  console.log(`\n[${it._source}] course=${it.course}`);
  console.log(`  Prof: ${it.professor.text.slice(0, 80)}...`);
  console.log(`  ${it.students[0].name}: ${it.students[0].text.slice(0, 60)}...`);
  console.log(`  ${it.students[1].name}: ${it.students[1].text.slice(0, 60)}...`);
}
