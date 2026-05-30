import fs from "node:fs";
const real = JSON.parse(fs.readFileSync("D:/toefl_writing/data/realExam2026/writing/academicDiscussion.json", "utf8")).items;
const gen = JSON.parse(fs.readFileSync("D:/toefl_writing/data/academicWriting/prompts.json", "utf8"));
const profPosts = JSON.parse(fs.readFileSync("D:/toefl_writing/scripts/research/ad_eval/prof_posts_real.json", "utf8")).posts;

// 1. Real student openers classified "other" — print them to verify
function openerClass(t) {
  const s = (t || "").trim();
  if (/^I (believe|think|feel)\b/i.test(s)) return "I believe/think";
  if (/^In my opinion\b/i.test(s)) return "In my opinion";
  if (/^(While|Although|Though)\b/i.test(s)) return "While/Although";
  if (/^I (oppose|support|absolutely|disagree|agree)\b/i.test(s)) return "I oppose/support";
  if (/^Yes\b|^No\b/i.test(s)) return "Yes/No direct";
  return "other";
}
console.log("===== REAL student openers == 'other' (verify each is genuinely not a stock opener) =====");
real.flatMap(r => (r.students||[]).map(s=>s.text)).filter(Boolean).filter(t=>openerClass(t)==="other")
  .forEach(t => console.log("  •", t.slice(0,70)));

// 2. Verify S2-refs-S1 = 0 in real: print any item where s2 contains s1 name OR any capitalized known name
console.log("\n===== REAL: does S2 mention S1's name or any student name? =====");
const NAMES = ["Claire","Paul","Andrew","Kelly","Emily","Olivia","Ryan","Cameron","Sarah","Joe","Steve","David"];
real.forEach(r => {
  const st = r.students||[];
  if (st.length<2) return;
  const s2 = st[1].text||"";
  const hit = NAMES.filter(n => new RegExp(`\\b${n}\\b`).test(s2));
  if (hit.length) console.log(`  ${r.id}: S1=${st[0].name} | S2 mentions: ${hit.join(",")}`);
});
console.log("(empty above = no S2 references any name)");

// 3. Verify prof opener + framing + contraction on the 36 transcribed, print compact table
function profOpener(t) {
  const s=(t||"").trim();
  if (/^We'?ve been (discussing|talking|exploring)/i.test(s)) return "Weve-been";
  if (/^We (often|have been) /i.test(s)) return "We-often/have";
  if (/^This week,? we/i.test(s)) return "This-week";
  if (/^Today,?\s+we/i.test(s)||/^Today'?s /i.test(s)) return "Today";
  if (/^These days/i.test(s)) return "These-days";
  if (/^Over the next/i.test(s)) return "Over-weeks";
  return "OTHER";
}
function hasFraming(t){
  const some=/\bSome\b/.test(t)||/\bsome (experts|economists|sociologists|historians|anthropologists|educators|marketers|scholars|business leaders|people|studies|argue|writers)\b/i.test(t);
  const other=/\bOthers\b/.test(t)||/\bwhile others\b/i.test(t)||/\bother (scholars|experts|people)\b/i.test(t)||/\bOn the other hand\b/i.test(t)||/\bBut critics\b/i.test(t);
  return some&&other;
}
function contr(t){const m=(t||"").match(/\b(we've|it's|i'm|don't|we're|let's|that's|we'll|you're|can't|won't|doesn't|isn't|aren't)\b/gi);return m?m.length:0;}
console.log("\n===== TRANSCRIBED PROF POSTS: opener | framing | #contr | first 45ch =====");
profPosts.forEach(p=>{
  console.log(`  ${profOpener(p.text).padEnd(12)} F=${hasFraming(p.text)?"Y":"n"} c=${contr(p.text)}  ${p.text.slice(0,48)}`);
});

// 4. Real prof posts NOT having framing — print to confirm they genuinely lack two-sided
console.log("\n===== TRANSCRIBED: prof posts WITHOUT 'Some..Others' framing (verify) =====");
profPosts.filter(p=>!hasFraming(p.text)).forEach(p=>console.log("  •",p.date, "|", p.text.slice(0,120)));

// 5. Gen student openers 'other' — sample 12 to see what they are
console.log("\n===== GEN student openers=='other' (sample 14) =====");
gen.flatMap(r=>(r.students||[]).map(s=>s.text)).filter(Boolean).filter(t=>openerClass(t)==="other").slice(0,14)
  .forEach(t=>console.log("  •", t.slice(0,62)));
