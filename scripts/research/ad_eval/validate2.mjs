import fs from "node:fs";
const gen = JSON.parse(fs.readFileSync("D:/toefl_writing/data/academicWriting/prompts.json", "utf8"));
const profPosts = JSON.parse(fs.readFileSync("D:/toefl_writing/scripts/research/ad_eval/prof_posts_real.json", "utf8")).posts;

// Refined framing: also count "However, some argue / but critics / on the other hand" as two-sided contrast
function hasFramingStrict(t){ // both Some...Others
  return (/\bSome\b/i.test(t)) && (/\bOthers\b/i.test(t)||/\bwhile others\b/i.test(t));
}
function hasContrast(t){ // any explicit two-sided contrast device
  const some=/\bSome\b/i.test(t)||/\bsome (experts|economists|sociologists|historians|anthropologists|educators|marketers|scholars|business leaders|people|studies|writers|argue)\b/i.test(t);
  const other=/\bOthers\b/i.test(t)||/\bwhile others\b/i.test(t)||/\bOn the other hand\b/i.test(t)||/\bHowever,? some\b/i.test(t)||/\bBut critics\b/i.test(t)||/\bother (scholars|experts|people)\b/i.test(t);
  return some&&other;
}
const pt = profPosts.map(p=>p.text);
console.log("PROF framing STRICT (Some+Others):", pt.filter(hasFramingStrict).length, "/", pt.length);
console.log("PROF contrast BROAD (incl However-some/OTOH/But-critics):", pt.filter(hasContrast).length, "/", pt.length);

// Which transcribed posts still lack ANY contrast device?
console.log("\nPosts with NO contrast device at all:");
pt.map((t,i)=>({t,d:profPosts[i].date})).filter(x=>!hasContrast(x.t)).forEach(x=>console.log("  •",x.d,"|",x.t.slice(0,110)));

// GEN prof openers full breakdown — confirm 'other' bucket content
function profOpener(t){
  const s=(t||"").trim();
  if (/^We'?ve been (discussing|talking|exploring)/i.test(s)) return "Weve-been";
  if (/^We (often|have been) /i.test(s)) return "We-often/have";
  if (/^This week,? we/i.test(s)) return "This-week";
  if (/^Today,?\s+we/i.test(s)||/^Today'?s /i.test(s)) return "Today";
  if (/^These days/i.test(s)) return "These-days";
  if (/^(As we|As I) (discussed|mentioned)/i.test(s)) return "As-we-discussed";
  if (/^Over the next/i.test(s)) return "Over-weeks";
  if (/^For this week/i.test(s)) return "For-this-week";
  return "OTHER";
}
console.log("\nGEN prof opener 'OTHER' sample (12):");
gen.map(r=>r.professor?.text).filter(Boolean).filter(t=>profOpener(t)==="OTHER").slice(0,12).forEach(t=>console.log("  •",t.slice(0,55)));

// GEN contrast device rate (broad)
const gt = gen.map(r=>r.professor?.text).filter(Boolean);
console.log("\nGEN contrast BROAD:", gt.filter(hasContrast).length, "/", gt.length, "=", Math.round(100*gt.filter(hasContrast).length/gt.length)+"%");
console.log("GEN framing STRICT:", gt.filter(hasFramingStrict).length, "/", gt.length);

// Does gen use the "Some experts argue ... Others believe ..." canonical 2026 sentence? Count "Some" AND "Others" adjacency
function canonicalTwoSided(t){
  return /Some[^.]*\.\s*Others\b/i.test(t) || /Some[^,]*,\s*while others\b/i.test(t) || /Some[^.]*\bargue[^.]*\.\s*Others\b/i.test(t);
}
console.log("\nREAL canonical 'Some...Others' adjacency:", pt.filter(canonicalTwoSided).length,"/",pt.length);
console.log("GEN  canonical 'Some...Others' adjacency:", gt.filter(canonicalTwoSided).length,"/",gt.length);
