#!/usr/bin/env node
// Evaluate whether realExam2026 has enough data to CALIBRATE each type's gen prompt.
// Calibration needs: n big enough for stable distributions (n>=30 ok, >=50 strong),
// + measurable spread on the dimensions a prompt encodes (length, diversity, structure).
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const B = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "data/realExam2026");
const J = (p) => JSON.parse(readFileSync(resolve(B, p), "utf8"));
const wc = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
const stats = (a) => { if (!a.length) return "n/a"; const s = [...a].sort((x, y) => x - y); const m = Math.round(a.reduce((x, y) => x + y, 0) / a.length); return `mean ${m} [${s[0]}–${s[s.length - 1]}]`; };
const distinct = (a) => new Set(a.map((x) => String(x || "").toLowerCase().trim()).filter(Boolean)).size;
const verdict = (n) => n >= 50 ? "🟢 强(n≥50)" : n >= 30 ? "🟡 够(n≥30)" : n >= 15 ? "🟠 偏少" : "🔴 不足";

console.log("题型校准就绪度评测(realExam2026)\n" + "=".repeat(64));

// ---- BS ----
const bsT = J("writing/buildSentence-targets.json").items;
const bsLen = bsT.map((x) => wc(x.target));
const bsQ = bsT.filter((x) => /\?$/.test((x.target || "").trim())).length;
console.log(`\n[Build a Sentence] n=${bsT.length}  ${verdict(bsT.length)}`);
console.log(`  目标句长: ${stats(bsLen)} 词 | 疑问句占比: ${Math.round(bsQ / bsT.length * 100)}% | 可校准: 句长/句型/prefilled/干扰词`);

// ---- AD ----
const ad = J("writing/academicDiscussion.json").items;
console.log(`\n[Academic Discussion] n=${ad.length}  ${verdict(ad.length)}`);
console.log(`  distinct课程: ${distinct(ad.map((x) => x.course))} | 教授问题长: ${stats(ad.map((x) => wc(x.professor_question)))} 词`);
console.log(`  含2学生: ${ad.filter((x) => (x.students || []).length >= 2).length}/${ad.length} | 学生帖长: ${stats(ad.flatMap((x) => (x.students || []).map((s) => wc(s.text))))} 词`);

// ---- Email ----
const em = J("writing/email.json").items;
console.log(`\n[Email] n=${em.length}  ${verdict(em.length)}`);
console.log(`  distinct主题: ${distinct(em.map((x) => x.subject))} | bullets/题: ${stats(em.map((x) => (x.bullets || []).length))} | 场景长: ${stats(em.map((x) => wc(x.scenario)))} 词`);

// ---- Reading AP ----
const ap = J("reading/academicPassage.json").items;
console.log(`\n[Reading · AP理解] n=${ap.length}  ${verdict(ap.length)}`);
console.log(`  passage长: ${stats(ap.map((x) => wc(x.passage)))} 词 | 题/篇: ${stats(ap.map((x) => (x.questions || []).length))} | distinct主题: ${distinct(ap.map((x) => x.topic))}`);

// ---- Reading CTW ----
const ctw = J("reading/completeTheWords.json").items;
console.log(`\n[Reading · CTW填词] n=${ctw.length}  ${verdict(ctw.length)}`);
console.log(`  段落长: ${stats(ctw.map((x) => wc(x.paragraph)))} 词`);

// ---- Listening ----
const lc = J("listening/conversations.json").items, la = J("listening/announcements.json").items, lat = J("listening/lectures.json").items;
const lAll = lc.length + la.length + lat.length;
const lLen = [...lc.map((x) => wc((x.conversation || []).map((t) => t.text).join(" "))), ...la.map((x) => wc(x.transcript)), ...lat.map((x) => wc(x.transcript))];
console.log(`\n[Listening] n=${lAll} (对话${lc.length}/通知${la.length}/讲座${lat.length})  ${verdict(lAll)}`);
console.log(`  各子类型均≥30: ${[lc.length, la.length, lat.length].every((x) => x >= 30) ? "是 🟢" : "否"} | 篇章长: ${stats(lLen)} 词`);

// ---- Speaking ----
const rep = J("speaking/repeat.json").items || J("speaking/repeat.json").sets;
const repData = J("speaking/repeat.json");
const repSets = repData.sets || repData.items;
const repSent = repSets.flatMap((s) => (s.sentences || []).map((x) => x.text || x));
const iv = J("speaking/interview.json").items;
console.log(`\n[Speaking · repeat] 套数=${repSets.length} 句=${repSent.length}  ${verdict(repSent.length)}`);
console.log(`  句长: ${stats(repSent.map((x) => wc(x)))} 词(可校准难度梯度)`);
console.log(`\n[Speaking · interview] n=${iv.length}  ${verdict(iv.length)}`);
console.log(`  问题/任务: ${stats(iv.map((x) => (x.questions || []).length))}`);
