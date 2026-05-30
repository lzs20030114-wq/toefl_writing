import fs from "node:fs";

const real = JSON.parse(fs.readFileSync("D:/toefl_writing/data/realExam2026/writing/academicDiscussion.json", "utf8")).items;
const gen = JSON.parse(fs.readFileSync("D:/toefl_writing/data/academicWriting/prompts.json", "utf8"));
const profPosts = JSON.parse(fs.readFileSync("D:/toefl_writing/scripts/research/ad_eval/prof_posts_real.json", "utf8")).posts;

const words = (s) => (s || "").trim().split(/\s+/).filter(Boolean).length;
const sentences = (s) => (s || "").split(/[.?!]+/).map(x => x.trim()).filter(x => x.length > 1).length;
const chars = (s) => (s || "").length;
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

function stats(arr) {
  if (!arr.length) return { n: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n: s.length, mean: round(sum / s.length), med: s[Math.floor(s.length / 2)],
    min: s[0], max: s[s.length - 1],
    p25: s[Math.floor(s.length * 0.25)], p75: s[Math.floor(s.length * 0.75)],
  };
}

// ---------- structured real bank: students ----------
const realWithStudents = real.filter(r => (r.students || []).length >= 2);
const realStudentTexts = real.flatMap(r => (r.students || []).map(s => s.text).filter(Boolean));
const genStudentTexts = gen.flatMap(r => (r.students || []).map(s => s.text).filter(Boolean));

console.log("=== STUDENT POST LENGTH (words) ===");
console.log("REAL:", JSON.stringify(stats(realStudentTexts.map(words))));
console.log("GEN :", JSON.stringify(stats(genStudentTexts.map(words))));
console.log("=== STUDENT POST LENGTH (chars) ===");
console.log("REAL:", JSON.stringify(stats(realStudentTexts.map(chars))));
console.log("GEN :", JSON.stringify(stats(genStudentTexts.map(chars))));
console.log("=== STUDENT POST SENTENCES ===");
console.log("REAL:", JSON.stringify(stats(realStudentTexts.map(sentences))));
console.log("GEN :", JSON.stringify(stats(genStudentTexts.map(sentences))));

// students count per item
const realStuCounts = real.map(r => (r.students || []).length);
const genStuCounts = gen.map(r => (r.students || []).length);
console.log("\n=== #STUDENTS PER ITEM ===");
const cnt = (arr) => arr.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});
console.log("REAL:", JSON.stringify(cnt(realStuCounts)), "of", real.length);
console.log("GEN :", JSON.stringify(cnt(genStuCounts)), "of", gen.length);

// ---------- student opener phrasing ----------
function openerClass(t) {
  const s = (t || "").trim();
  if (/^I (believe|think|feel)\b/i.test(s)) return "I believe/think";
  if (/^In my opinion\b/i.test(s)) return "In my opinion";
  if (/^(While|Although|Though)\b/i.test(s)) return "While/Although (concessive)";
  if (/^I (oppose|support|absolutely|disagree|agree)\b/i.test(s)) return "I oppose/support";
  if (/^Yes\b|^No\b/i.test(s)) return "Yes/No direct";
  return "other";
}
console.log("\n=== STUDENT OPENER (real) ===");
console.log(JSON.stringify(cnt(realStudentTexts.map(openerClass)), null, 0));
console.log("=== STUDENT OPENER (gen) ===");
console.log(JSON.stringify(cnt(genStudentTexts.map(openerClass)), null, 0));

// ---------- S2 references S1 by name ----------
function s2RefsS1(item) {
  const st = item.students || [];
  if (st.length < 2) return null;
  const s1name = (st[0].name || "").trim();
  if (!s1name || s1name.length < 2) return null;
  return new RegExp(`\\b${s1name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(st[1].text || "");
}
const realRefs = realWithStudents.map(s2RefsS1).filter(x => x !== null);
const genRefs = gen.map(s2RefsS1).filter(x => x !== null);
console.log("\n=== S2 REFERENCES S1 BY NAME ===");
console.log("REAL:", realRefs.filter(Boolean).length, "/", realRefs.length, "=", round(100 * realRefs.filter(Boolean).length / realRefs.length) + "%");
console.log("GEN :", genRefs.filter(Boolean).length, "/", genRefs.length, "=", round(100 * genRefs.filter(Boolean).length / genRefs.length) + "%");

// ---------- student has personal/concrete example ----------
const personalRe = /\b(my|I |we |our )\b/i;
const concreteMarkers = /\b(my (cousin|uncle|parents|family|friend|sister|brother|hometown|old school)|For example|for instance|I remember|when I|At my)\b/i;
const realPersonal = realStudentTexts.filter(t => concreteMarkers.test(t)).length;
const genPersonal = genStudentTexts.filter(t => concreteMarkers.test(t)).length;
console.log("\n=== STUDENT USES CONCRETE/PERSONAL EXAMPLE ===");
console.log("REAL:", realPersonal, "/", realStudentTexts.length, "=", round(100 * realPersonal / realStudentTexts.length) + "%");
console.log("GEN :", genPersonal, "/", genStudentTexts.length, "=", round(100 * genPersonal / genStudentTexts.length) + "%");

// ---------- length differential between the two students ----------
function lenDiff(item) {
  const st = item.students || [];
  if (st.length < 2) return null;
  return Math.abs(chars(st[0].text) - chars(st[1].text));
}
const realDiffs = realWithStudents.map(lenDiff).filter(x => x !== null);
const genDiffs = gen.map(lenDiff).filter(x => x !== null);
const bucket = (d) => d <= 30 ? "≤30" : d <= 100 ? "31-100" : "100+";
console.log("\n=== STUDENT LENGTH DIFFERENTIAL (chars) ===");
console.log("REAL:", JSON.stringify(cnt(realDiffs.map(bucket))), "mean", stats(realDiffs).mean);
console.log("GEN :", JSON.stringify(cnt(genDiffs.map(bucket))), "mean", stats(genDiffs).mean);

// ====================================================================
// PROFESSOR POST (from hand-transcribed full posts)
// ====================================================================
console.log("\n\n########## PROFESSOR POST (transcribed real, n=" + profPosts.length + ") ##########");
const profTexts = profPosts.map(p => p.text);
const genProfTexts = gen.map(r => r.professor?.text).filter(Boolean);

console.log("=== PROF POST LENGTH (words) ===");
console.log("REAL:", JSON.stringify(stats(profTexts.map(words))));
console.log("GEN :", JSON.stringify(stats(genProfTexts.map(words))));
console.log("=== PROF POST LENGTH (chars) ===");
console.log("REAL:", JSON.stringify(stats(profTexts.map(chars))));
console.log("GEN :", JSON.stringify(stats(genProfTexts.map(chars))));
console.log("=== PROF POST SENTENCES ===");
console.log("REAL:", JSON.stringify(stats(profTexts.map(sentences))));
console.log("GEN :", JSON.stringify(stats(genProfTexts.map(sentences))));

// ---------- opener style ----------
function profOpener(t) {
  const s = (t || "").trim();
  if (/^We'?ve been (discussing|talking|exploring)/i.test(s)) return "We've been discussing/talking/exploring";
  if (/^We (often|have been) /i.test(s)) return "We often/We have been";
  if (/^This week,? we/i.test(s)) return "This week we";
  if (/^Today,?\s+we/i.test(s) || /^Today'?s /i.test(s)) return "Today we/Today's";
  if (/^These days/i.test(s)) return "These days";
  if (/^(As we|As I) (discussed|mentioned)/i.test(s)) return "As we discussed";
  if (/^Over the next/i.test(s)) return "Over the next few weeks";
  return "other (topic-first / definition / factual)";
}
console.log("\n=== PROF OPENER STYLE (real) ===");
console.log(JSON.stringify(cnt(profTexts.map(profOpener)), null, 0));
console.log("=== PROF OPENER STYLE (gen) ===");
console.log(JSON.stringify(cnt(genProfTexts.map(profOpener)), null, 0));

// ---------- "Some ... Others/while others ..." balanced framing ----------
const framingRe = /\b(Some|Others|some experts|some \w+ argue|while others|some argue)\b/i;
function hasFraming(t) {
  const some = /\bSome\b/.test(t) || /\bsome (experts|economists|sociologists|historians|anthropologists|educators|marketers|scholars|business leaders|people|studies|argue|writers)\b/i.test(t);
  const other = /\bOthers\b/.test(t) || /\bwhile others\b/i.test(t) || /\bother (scholars|experts|people)\b/i.test(t) || /\bOn the other hand\b/i.test(t) || /\bBut critics\b/i.test(t);
  return some && other;
}
const realFraming = profTexts.filter(hasFraming).length;
const genFraming = genProfTexts.filter(hasFraming).length;
console.log("\n=== PROF POST: 'Some X ... Others Y' two-sided framing ===");
console.log("REAL:", realFraming, "/", profTexts.length, "=", round(100 * realFraming / profTexts.length) + "%");
console.log("GEN :", genFraming, "/", genProfTexts.length, "=", round(100 * genFraming / genProfTexts.length) + "%");

// ---------- contractions in prof post ----------
const contractionRe = /\b(we'?ve|it'?s|i'?m|don'?t|we'?re|let'?s|that'?s|we'?ll|you'?re|can'?t|won'?t|doesn'?t|isn'?t|aren'?t|today'?s|student'?s)\b/gi;
function contractionCount(t) {
  const m = (t || "").match(/\b(we've|it's|i'm|don't|we're|let's|that's|we'll|you're|can't|won't|doesn't|isn't|aren't)\b/gi);
  return m ? m.length : 0;
}
const realContr = profTexts.map(contractionCount);
const genContr = genProfTexts.map(contractionCount);
console.log("\n=== PROF POST CONTRACTIONS (count of true contractions, excl. possessives) ===");
console.log("REAL: has>=1:", realContr.filter(x => x >= 1).length, "/", profTexts.length, "=", round(100 * realContr.filter(x => x >= 1).length / profTexts.length) + "%", "mean/post", stats(realContr).mean);
console.log("GEN : has>=1:", genContr.filter(x => x >= 1).length, "/", genProfTexts.length, "=", round(100 * genContr.filter(x => x >= 1).length / genProfTexts.length) + "%", "mean/post", stats(genContr).mean);

// ---------- final question stem type ----------
function questionType(t) {
  // take last question
  const qs = (t || "").match(/[^.?!]*\?/g) || [];
  const q = (qs[qs.length - 1] || "").trim();
  if (/^Do you (think|believe|agree)|^Is (it|the)\b|^Are the\b/i.test(q.replace(/^[^A-Za-z]+/, ""))) {
    if (/\bor\b/i.test(q)) return "binary-or (X or Y?)";
    return "binary (Do you think X?)";
  }
  if (/^Which\b/i.test(q.replace(/^[^A-Za-z]+/, ""))) return "which-choice";
  if (/^What (do you think|is your|are your)/i.test(q.replace(/^[^A-Za-z]+/, ""))) return "open (What do you think/your view)";
  if (/^How\b/i.test(q.replace(/^[^A-Za-z]+/, ""))) return "how";
  if (/\bor\b/i.test(q)) return "binary-or (X or Y?)";
  return "other";
}
console.log("\n=== PROF FINAL QUESTION STEM TYPE (real) ===");
console.log(JSON.stringify(cnt(profTexts.map(questionType)), null, 0));
// use professor_question for the structured real bank too
const realQ = real.map(r => r.professor_question).filter(Boolean);
console.log("=== PROF QUESTION STEM TYPE (real structured professor_question, n=" + realQ.length + ") ===");
console.log(JSON.stringify(cnt(realQ.map(q => questionType(q + (/\?$/.test(q) ? "" : "?")))), null, 0));

// ---------- trailing "Why?" / "Why or why not?" ----------
const whyRe = /\bWhy(\?| or why not\?| do you think so\?)|\bExplain your (views|reasoning)\b|Give reasons/i;
const realWhy = profTexts.filter(t => whyRe.test(t)).length;
const genWhy = genProfTexts.filter(t => whyRe.test(t)).length;
console.log("\n=== PROF POST ends with Why?/Why or why not?/Explain ===");
console.log("REAL:", realWhy, "/", profTexts.length, "=", round(100 * realWhy / profTexts.length) + "%");
console.log("GEN :", genWhy, "/", genProfTexts.length, "=", round(100 * genWhy / genProfTexts.length) + "%");

// ---------- professor name format ----------
console.log("\n=== PROFESSOR NAME FORMAT ===");
const realNames = real.map(r => r.professor).filter(x => x !== undefined);
const realNameClass = realNames.map(n => !n ? "(empty)" : /^Dr\. /.test(n) ? "Dr. X" : n === "Professor" ? "Professor" : "other:" + n);
console.log("REAL (structured):", JSON.stringify(cnt(realNameClass)));
const profPostNames = profPosts.map(p => p.prof).map(n => !n ? "(empty)" : /^Dr\. /.test(n) ? "Dr. X" : "other");
console.log("REAL (transcribed):", JSON.stringify(cnt(profPostNames)));
const genNames = gen.map(r => r.professor?.name).map(n => !n ? "(empty)" : /^Dr\. /.test(n) ? "Dr. X" : n === "Professor" ? "Professor" : "other");
console.log("GEN :", JSON.stringify(cnt(genNames)));

// distinct Dr names in real
const drNames = realNames.filter(n => /^Dr\. /.test(n));
console.log("REAL distinct Dr names:", JSON.stringify(cnt(drNames)));

// ---------- course distribution ----------
console.log("\n=== COURSE DISTRIBUTION (real, normalized lowercase) ===");
const norm = (c) => (c || "").toLowerCase().trim();
console.log("REAL:", JSON.stringify(cnt(real.map(r => norm(r.course)))));
console.log("\n=== COURSE DISTRIBUTION (gen) ===");
console.log("GEN :", JSON.stringify(cnt(gen.map(r => norm(r.course)))));

// ---------- student names distribution (real) ----------
console.log("\n=== STUDENT NAMES (real) ===");
const realStuNames = real.flatMap(r => (r.students || []).map(s => s.name)).filter(n => n && n.length > 1 && !/^I think$/.test(n));
console.log(JSON.stringify(cnt(realStuNames)));
