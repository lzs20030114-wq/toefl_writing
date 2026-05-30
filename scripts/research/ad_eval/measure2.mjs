import fs from "node:fs";
const real = JSON.parse(fs.readFileSync("D:/toefl_writing/data/realExam2026/writing/academicDiscussion.json", "utf8")).items;
const gen = JSON.parse(fs.readFileSync("D:/toefl_writing/data/academicWriting/prompts.json", "utf8"));
const round=(n,d=1)=>Math.round(n*10**d)/10**d;
const cnt=(arr)=>arr.reduce((m,x)=>(m[x]=(m[x]||0)+1,m),{});

// 1. Topic recurrence in REAL: cluster by the professor_question core
function topicKey(q){
  return (q||"").toLowerCase()
    .replace(/[^a-z ]/g,"")
    .split(/\s+/).filter(w=>w.length>4 && !["think","about","which","would","these","there","because"].includes(w))
    .slice(0,6).sort().join("-");
}
const realTopics = cnt(real.map(r=>topicKey(r.professor_question)));
const recurring = Object.entries(realTopics).filter(([k,v])=>v>=2).sort((a,b)=>b[1]-a[1]);
console.log("=== REAL recurring prompts (same core question reused across dates) ===");
recurring.forEach(([k,v])=>console.log(`  ${v}x  ${k.slice(0,60)}`));
console.log("distinct topics:", Object.keys(realTopics).length, "of", real.length, "items =>", round(100*Object.keys(realTopics).length/real.length)+"% unique");

// distinct full professor_question strings
const distinctQ = new Set(real.map(r=>(r.professor_question||"").toLowerCase().replace(/\s+/g," ").trim()));
console.log("distinct professor_question strings:", distinctQ.size, "of", real.length);

// 2. Student stance contrast: pro/con vs nuanced. Detect concessive in either student
const concessiveRe=/\b(while|although|though|however|on the other hand|i see the point|i acknowledge|partially|to be fair)\b/i;
function itemContrastType(item){
  const st=item.students||[]; if(st.length<2) return null;
  const anyConcessive = st.some(s=>concessiveRe.test(s.text||""));
  return anyConcessive ? "nuanced/concessive" : "clean pro-vs-con";
}
console.log("\n=== STANCE CONTRAST TYPE ===");
console.log("REAL:", JSON.stringify(cnt(real.map(itemContrastType).filter(Boolean))));
console.log("GEN :", JSON.stringify(cnt(gen.map(itemContrastType).filter(Boolean))));

// 3. Prompt-echo: do students repeat exact key phrase from professor_question?
function echoRate(items, getQ){
  let echo=0,total=0;
  for(const it of items){
    const q=(getQ(it)||"").toLowerCase();
    const qWords=new Set(q.replace(/[^a-z ]/g,"").split(/\s+/).filter(w=>w.length>5));
    for(const s of (it.students||[])){
      total++;
      const sw=(s.text||"").toLowerCase().replace(/[^a-z ]/g,"").split(/\s+/).filter(w=>w.length>5);
      const overlap=sw.filter(w=>qWords.has(w)).length;
      if(overlap>=2) echo++;
    }
  }
  return {echo,total,pct:round(100*echo/total)};
}
console.log("\n=== STUDENT ECHOES PROFESSOR KEY TERMS (>=2 content words shared) ===");
console.log("REAL:", JSON.stringify(echoRate(real, r=>r.professor_question)));
console.log("GEN :", JSON.stringify(echoRate(gen, r=>r.professor?.text)));

// 4. CORRELATION: prof post length vs has-framing (does richer setup => two-sided?)
// 5. Student post: first-person 'I' density
const fpRe=/\b(I|my|me|we|our)\b/gi;
const realFP = real.flatMap(r=>(r.students||[]).map(s=>((s.text||"").match(fpRe)||[]).length));
const genFP  = gen.flatMap(r=>(r.students||[]).map(s=>((s.text||"").match(fpRe)||[]).length));
const mean=(a)=>round(a.reduce((x,y)=>x+y,0)/a.length);
console.log("\n=== first-person pronoun count per student post ===");
console.log("REAL mean:", mean(realFP), "GEN mean:", mean(genFP));

// 6. Does real S1 vs S2 use parallel openers? (I believe / In my opinion pairing)
let parallelPairs=0, total2=0;
for(const r of real){
  const st=r.students||[]; if(st.length<2) continue; total2++;
  const a=(st[0].text||"").trim(), b=(st[1].text||"").trim();
  const aIb=/^I (believe|think)/i.test(a), bImo=/^In my opinion/i.test(b);
  const aIb2=/^I (believe|think)/i.test(a), bIb=/^I (believe|think)/i.test(b);
  if((aIb&&bImo)) parallelPairs++;
}
console.log("\n=== REAL: S1 'I believe/think' + S2 'In my opinion' canonical pairing ===");
console.log(parallelPairs,"/",total2,"=",round(100*parallelPairs/total2)+"%");
