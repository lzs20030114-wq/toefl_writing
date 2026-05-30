// BS (Build a Sentence) evaluation measurer — real 2026改后 vs current generated bank.
// Every detector below was hand-validated against the recalled items AND the rendered
// writing-screen PNGs (.codex-tmp/bs_render*/). Run: node scripts/research/bs_measure.mjs [--dump <dim>]
//
// Ground truth:
//   data/realExam2026/writing/buildSentence-targets.json  (504 answer sentences)
//   data/realExam2026/writing/buildSentence.json          (363 with prompt_context + scrambled_ocr)
//   .codex-tmp/ocr/*写作*.txt                              (raw on-screen OCR — prompt/prefilled/pool)
//   rendered PNGs (zoom 3.5) of 6 writing PDFs             (ground truth for prefilled & distractor)
// Current bank: data/buildSentence/questions.json (question_sets[].questions[])

import fs from 'fs';
import path from 'path';

const ROOT = 'D:/toefl_writing';
const T = JSON.parse(fs.readFileSync(path.join(ROOT,'data/realExam2026/writing/buildSentence-targets.json'),'utf8'));
const B = JSON.parse(fs.readFileSync(path.join(ROOT,'data/realExam2026/writing/buildSentence.json'),'utf8'));
const Q = JSON.parse(fs.readFileSync(path.join(ROOT,'data/buildSentence/questions.json'),'utf8'));
const REAL = T.items;                                   // 504
const REALP = B.items;                                  // 363 (with prompt/pool)
const CUR = Q.question_sets.flatMap(s => s.questions);  // generated

const dumpArg = process.argv.includes('--dump') ? process.argv[process.argv.indexOf('--dump')+1] : null;

// ---------- helpers ----------
const lc = s => String(s||'').toLowerCase().replace(/\s+/g,' ').trim();
const words = s => lc(s).replace(/[?.,!"]/g,' ').replace(/\s+/g,' ').trim().split(' ').filter(Boolean);
const norm = s => lc(s).replace(/[?.,!"]/g,'').replace(/\s+/g,' ').trim();
const sum = a => a.reduce((x,y)=>x+y,0);
const mean = a => a.length ? sum(a)/a.length : 0;
const median = a => { const s=[...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; };
const hist = a => { const h={}; a.forEach(x=>h[x]=(h[x]||0)+1); return h; };
const pctOf = (c,n) => (c/n*100).toFixed(1)+'%';
const stripOpener = t => t.replace(/^(yes\.?,?|no,?|yes,|no\.?|that'?s right\.?|sure\.?|sorry,?|unfortunately,?)\s+/,'');

// ---------- detectors (shared across both banks) ----------
const auxRe = /^(do|does|did|is|are|was|were|can|could|will|would|have|has|had|should|may)\b/i;
const whRe  = /^(what|why|how|where|when|which|who|whose)\b/i;
function isQuestionForm(s){
  if(/\?\s*$/.test(s)) return true;
  const t = stripOpener(lc(s)); const w = t.split(/\s+/);
  if(auxRe.test(t) && /^(you|i|it|they|we|he|she|the|there|your|someone)\b/i.test(w.slice(1).join(' '))) return true;
  if(whRe.test(t)){ const rest=w.slice(1).join(' ');
    if(auxRe.test(rest)) return true;
    if(/\b(do|does|did|will|are|is|can|would|have|should)\s+(you|i|they|we|he|she|it)\b/i.test(t)) return true; }
  return false;
}
const embRe = /\b(know (if|whether|when|where|why|who|what|which|how)|tell me (if|whether|when|where|why|who|what|which|how)|think (it'?s|it |that )|wanted to know|want to know|needed to know|need to know|asked me (if|whether|how|when|why|what|where|to)|asked (if|whether|how|when)|find out (if|whether|when|where|why|who|what)|wondering (if|whether|when|what)|not sure (what|who|whether|if|when|where|why|which|about|how)|decide (what|who|which|whether)|to know (if|whether|when|where|why|who|what))\b/i;
const hasEmbedded = s => embRe.test(lc(s));
const sigRe = /^(do you know (if|whether|when|where|why|who|what)|can you tell me (if|whether|when|where|why|who|what)|could you tell me|do you think (it|that))/i;
const isSignature = s => sigRe.test(stripOpener(lc(s)));
const negRe = /\b(not|n't|never|no longer|none of|no one|nobody|nothing|cannot|can't|won't|don'?t|doesn'?t|didn'?t|haven'?t|hasn'?t|hadn'?t|wasn'?t|weren'?t|isn'?t|aren'?t|wouldn'?t|couldn'?t|no intention|no time|no other|other plans|other commitment|prior engagement)\b/i;
const isNegation = s => negRe.test(lc(s));
const relRe = /\b(that (is|was|has|have|had|offers|covers|makes|ran|aims|aimed|published|mentioned|recommended|i |we |you |they |he |she |my |our )|which (is|was|covers|offers)|who (majors|is|was|helped|worked|arranged)|the one (i|that|i'?m)|where i )\b/i;
const isRelative = s => relRe.test(lc(s));
const passRe = /\b(was|were|been|being|is|are|be|has been|have been|had been)\s+(\w+ed|updated|cancel(l)?ed|published|listed|held|scheduled|structured|graded|announced|postponed|mentioned|arranged|caught|told|given|made|taken|done|known|supposed|located|set)\b/i;
const isPassive = s => passRe.test(lc(s));
const contrRe = /('s|'re|'ll|'ve|'d|'m|n't)\b|\b(isn't|aren't|won't|can't|don't|doesn't|didn't|haven't|wasn't|i'm|it's|that's|there's|we've|you'd|i've|i'd)\b/i;
const hasContraction = s => contrRe.test(lc(s));
const casualOpenRe = /^(yes|no|sorry|unfortunately|that's right|oh|well|sure|actually)[,.\s]/i;
const isCasualOpener = s => casualOpenRe.test(String(s).trim());
const firstPersonRe = /^(i\b|i'm|i've|i'd|my\b|no, i|yes, i|sorry, i|unfortunately, i)/i;
const isFirstPerson = s => firstPersonRe.test(String(s).trim());
const formalSubjRe = /^(the (manager|supervisor|student|professor|customer|software|project|delivery|store|company|department|developer|director|assistant|coordinator|recruiter|client|instructor|technician|new))/i;
const isFormalSubj = s => formalSubjRe.test(String(s).trim());

function classifyType(s){
  const q = isQuestionForm(s), e = hasEmbedded(s);
  if(q && e) return 'q-embedded';        // "do you know if..." / "can you tell whether..."
  if(q && !e) return 'q-plain';          // "what time does the game start?"
  if(!q && e) return 'decl-indirect';    // "she wanted to know when...", "I don't know who..."
  return 'statement';                    // "I missed the class this morning."
}

// ---------- run a dimension over a bank ----------
function tally(items, getText, fn){ return items.filter(it=>fn(getText(it))).length; }

const out = {};

// === REAL targets (504) ===
const rText = it => it.target;
const rLens = REAL.map(it=>words(it.target).length);
out.length_real = { mean:+mean(rLens).toFixed(2), median:median(rLens), min:Math.min(...rLens), max:Math.max(...rLens), hist:hist(rLens) };
out.difficulty_real = {
  easy_le7: REAL.filter(it=>words(it.target).length<=7).length,
  med_8to11: REAL.filter(it=>{const w=words(it.target).length; return w>=8&&w<=11;}).length,
  hard_ge12: REAL.filter(it=>words(it.target).length>=12).length,
};
out.qmark_real = REAL.filter(it=>/\?\s*$/.test(it.target)).length;
out.types_real = hist(REAL.map(it=>classifyType(it.target)));
out.signature_real = REAL.filter(it=>isSignature(it.target)).length;
out.embedded_real = tally(REAL,rText,hasEmbedded);
out.negation_real = tally(REAL,rText,isNegation);
out.relative_real = tally(REAL,rText,isRelative);
out.passive_real = tally(REAL,rText,isPassive);
out.contraction_real = tally(REAL,rText,hasContraction);
out.casualOpener_real = tally(REAL,rText,isCasualOpener);
out.firstPerson_real = tally(REAL,rText,isFirstPerson);
out.formalSubj_real = tally(REAL,rText,isFormalSubj);
out.dedup_real = { total:REAL.length, unique:new Set(REAL.map(it=>norm(it.target))).size };

// === CURRENT generated bank ===
const cText = it => it.answer;
const cLens = CUR.map(it=>words(it.answer).length);
out.length_cur = { mean:+mean(cLens).toFixed(2), median:median(cLens), min:Math.min(...cLens), max:Math.max(...cLens), hist:hist(cLens) };
out.difficulty_cur = {
  easy_le7: CUR.filter(it=>words(it.answer).length<=7).length,
  med_8to11: CUR.filter(it=>{const w=words(it.answer).length; return w>=8&&w<=11;}).length,
  hard_ge12: CUR.filter(it=>words(it.answer).length>=12).length,
};
out.qmark_cur = CUR.filter(it=>/\?\s*$/.test(it.answer)).length;
out.types_cur = hist(CUR.map(it=>classifyType(it.answer)));
out.signature_cur = CUR.filter(it=>isSignature(it.answer)).length;
out.embedded_cur = tally(CUR,cText,hasEmbedded);
out.negation_cur = tally(CUR,cText,isNegation);
out.relative_cur = tally(CUR,cText,isRelative);
out.passive_cur = tally(CUR,cText,isPassive);
out.contraction_cur = tally(CUR,cText,hasContraction);
out.casualOpener_cur = tally(CUR,cText,isCasualOpener);
out.firstPerson_cur = tally(CUR,cText,isFirstPerson);
out.formalSubj_cur = tally(CUR,cText,isFormalSubj);

// === DISTRACTOR (current only — real has none; see render check) ===
const curD = CUR.filter(it=>it.distractor && String(it.distractor).trim().length>0);
out.distractor_cur = { present:curD.length, n:CUR.length, distinct:new Set(curD.map(it=>lc(it.distractor))).size, top:Object.entries(hist(curD.map(it=>lc(it.distractor)))).sort((a,b)=>b[1]-a[1]).slice(0,12) };

// === CHUNKS (current) ===
const curEff = CUR.map(it=>{const c=(it.chunks||[]).length; return it.distractor?c-1:c;});
const curChunkWL = CUR.flatMap(it=>(it.chunks||[]).map(c=>String(c).trim().split(/\s+/).length));
out.chunks_cur = { effMean:+mean(curEff).toFixed(2), effHist:hist(curEff), singleWordPct:+(curChunkWL.filter(w=>w===1).length/curChunkWL.length*100).toFixed(1), meanWordsPerChunk:+mean(curChunkWL).toFixed(2) };

// === PREFILLED (current) ===
const curP = CUR.filter(it=>Array.isArray(it.prefilled)&&it.prefilled.length>0);
const curPwc = curP.flatMap(it=>it.prefilled.map(p=>String(p).trim().split(/\s+/).length));
out.prefilled_cur = {
  presence:curP.length, n:CUR.length,
  segHist:hist(curP.map(it=>it.prefilled.length)),
  multiSegPct:+(curP.filter(it=>it.prefilled.length>=2).length/curP.length*100).toFixed(1),
  segWordMean:+mean(curPwc).toFixed(2), segWordHist:hist(curPwc),
  personHintPct:+(curP.filter(it=>it.prefilled.some(p=>/^(i|he|she|they|we|i'm|i've|i'd)$/i.test(String(p).trim()))).length/curP.length*100).toFixed(1),
  nonZeroPosPct:+(curP.filter(it=>Object.values(it.prefilled_positions||{}).some(v=>v>0)).length/curP.length*100).toFixed(1),
};

// === PROMPT (current uses .prompt) ===
const cur_you = CUR.filter(it=>/\byou\b|\byour\b/i.test(it.prompt||'')).length;
const cur_q   = CUR.filter(it=>/\?\s*$/.test(it.prompt||'')).length;
function popener(p){ const t=lc(p);
  if(/^what\b/.test(t)) return 'whatX';
  if(/^(why|where|when|which|how|who)\b/.test(t)) return 'otherWh';
  if(/^(did|do|does|are|is|was|were|have|has|had|will|would|can|could|should)\b/.test(t)) return 'yesno';
  if(/\?\s*$/.test(p)) return 'otherQ';
  return 'statement'; }
out.prompt_cur = { you:cur_you, q:cur_q, n:CUR.length, openers:hist(CUR.map(it=>popener(it.prompt||''))) };

// === PROMPT (real — robust OCR-tolerant classifier over the 363 with prompt/pool) ===
function normNS(s){ return String(s||'').toLowerCase().replace(/[^a-z?']/g,''); }
const hasYouNS = s => /you|your/.test(normNS(s));
const endsQ = s => /\?\s*$/.test(String(s).trim());
const openerNS = /^(whydidn|whatdid|whatdoes|whatis|whatare|whatwill|whattime|whattopics|whatkind|whatplaces|whatchanges|whatdo|whydid|whydo|whyare|whyhaven|whyweren|whywas|wheredid|whereis|whereare|wheredo|whendid|whichoff|which|howdid|howdo|howwas|didyou|doyou|areyou|wasyou|wereyou|haveyou|hasyou|hadyou|willyou|wouldyou|canyou|couldyou|shouldyou|whohelped|whoprepared|who|implanning|im|isigned|isaw|ispoke|ilost|iheard|ineed|imthinking|impreparing|imgoing|imstudying|theprofessor|thechemistry|thelecture|theclass|myroommate|myclassmate|todaywe|wevebeen|arethere|theresa|thereisa)/i;
function pickRealPrompt(it){
  const cands=[]; if(it.prompt_context) cands.push(it.prompt_context); if(Array.isArray(it.scrambled_ocr)) cands.push(...it.scrambled_ocr);
  const filt=cands.filter(c=>{const ns=normNS(c); if(ns.length<6) return false; if(/makeanappropriate/.test(ns)) return false; if(/^screen|hidetim|^qing|^oing|^ing$|mp$|^vio|^coing|^leing/.test(ns)) return false; return true;});
  let best=null,bs=-1; for(const c of filt){ let sc=0; if(openerNS.test(normNS(c))) sc+=3; if(endsQ(c)) sc+=2; if(hasYouNS(c)) sc+=1; if(sc>bs){bs=sc;best=c;} }
  return {prompt:best,score:bs};
}
function classifyRealOpener(p){ const ns=normNS(p); const q=endsQ(p);
  if(!q && /^(i|im|ive|id|my|the|we|wevebeen|today|theresa|thereisa|there)/.test(ns)) return 'statement';
  if(/^(whatdid|whatdoes|whatis|whatare|whatwill|whattime|whattopics|whatkind|whatplaces|whatchanges|whatdo|what)/.test(ns)) return 'whatX';
  if(/^(whydidn|whydid|whydo|whyare|whyhaven|whyweren|whywas|why|wheredid|whereis|whereare|wheredo|where|whendid|when|whichoff|which|howdid|howdo|howwas|how|whohelped|whoprepared|who)/.test(ns)) return 'otherWh';
  if(/^(didyou|doyou|areyou|wasyou|wereyou|haveyou|hasyou|hadyou|willyou|wouldyou|canyou|couldyou|shouldyou|did|do|does|are|is|was|were|have|has|had|will|would|can|could|should)/.test(ns)) return 'yesno';
  if(!q) return 'statement'; return 'unknown';
}
let rYou=0,rQ=0,rClass=0; const rOpen={whatX:0,otherWh:0,yesno:0,statement:0,unknown:0};
for(const it of REALP){ const {prompt,score}=pickRealPrompt(it); if(!prompt||score<2){ rOpen.unknown++; continue; } rClass++; if(hasYouNS(prompt)) rYou++; if(endsQ(prompt)) rQ++; rOpen[classifyRealOpener(prompt)]++; }
out.prompt_real = { classified:rClass, unknown:rOpen.unknown, you:rYou, q:rQ, openers:{whatX:rOpen.whatX,otherWh:rOpen.otherWh,yesno:rOpen.yesno,statement:rOpen.statement} };

// === DOMAIN (real prompt+pool blob vs current answer+prompt) ===
const officeRe=/\b(manager|supervisor|shipment|warehouse|invoice|inventory|coworker|quarterly|vendor|memo|the firm|the office|customer service|sales report|territory|sprint|migration)\b/i;
const campusRe=/\b(class|lecture|professor|assignment|exam|course|campus|semester|study|seminar|workshop|library|presentation|orientation|major|dorm|roommate|classmate|university|syllabus|chemistry|biology|tutor|quiz|midterm|scholarship)\b/i;
let rO=0,rC=0; REALP.forEach(it=>{const b=((it.prompt_context||'')+' '+(it.scrambled_ocr||[]).join(' ')).toLowerCase(); if(officeRe.test(b)) rO++; if(campusRe.test(b)) rC++;});
let cO=0,cC=0; CUR.forEach(it=>{const b=lc(it.answer+' '+(it.prompt||'')); if(officeRe.test(b)) cO++; if(campusRe.test(b)) cC++;});
out.domain = { real:{campus:rC,office:rO,n:REALP.length}, cur:{campus:cC,office:cO,n:CUR.length} };

// ---------- DUMP mode ----------
if(dumpArg){
  const re = { types:classifyType, signature:isSignature, embedded:hasEmbedded, negation:isNegation, relative:isRelative, passive:isPassive, casual:isCasualOpener, contraction:hasContraction };
  if(dumpArg==='types'){ REAL.forEach(it=>console.log(classifyType(it.target),'|',it.target)); }
  else if(re[dumpArg]){ REAL.filter(it=>re[dumpArg](it.target)).forEach(it=>console.log(it.target)); }
  else if(dumpArg==='distractor'){ curD.slice(0,40).forEach(it=>console.log(it.distractor,'<=',it.answer)); }
  else console.log('unknown dump dim');
  process.exit(0);
}

// ---------- print summary ----------
const nR=REAL.length, nC=CUR.length, nRP=REALP.length;
function row(label, rc, cc){ console.log(label.padEnd(34), `real ${String(rc).padStart(4)} ${pctOf(rc,nR).padStart(6)}   |  cur ${String(cc).padStart(4)} ${pctOf(cc,nC).padStart(6)}`); }
console.log(`\n=== BS measure | real targets n=${nR} (unique ${out.dedup_real.unique}) | real w/prompt n=${nRP} | current n=${nC} ===\n`);
console.log('LENGTH  real mean', out.length_real.mean, 'median', out.length_real.median, '| cur mean', out.length_cur.mean, 'median', out.length_cur.median);
console.log('  real hist', JSON.stringify(out.length_real.hist));
console.log('  cur  hist', JSON.stringify(out.length_cur.hist));
console.log('DIFFICULTY (len proxy)  real e/m/h', `${pctOf(out.difficulty_real.easy_le7,nR)}/${pctOf(out.difficulty_real.med_8to11,nR)}/${pctOf(out.difficulty_real.hard_ge12,nR)}`,
            '| cur', `${pctOf(out.difficulty_cur.easy_le7,nC)}/${pctOf(out.difficulty_cur.med_8to11,nC)}/${pctOf(out.difficulty_cur.hard_ge12,nC)}`);
console.log('TYPES real', JSON.stringify(out.types_real));
console.log('TYPES cur ', JSON.stringify(out.types_cur));
console.log('');
row('Q-mark (ends ?)', out.qmark_real, out.qmark_cur);
row('"do you know if/can you tell"', out.signature_real, out.signature_cur);
row('embedded clause', out.embedded_real, out.embedded_cur);
row('negation', out.negation_real, out.negation_cur);
row('relative clause', out.relative_real, out.relative_cur);
row('passive', out.passive_real, out.passive_cur);
row('contraction', out.contraction_real, out.contraction_cur);
row('casual opener (Yes/No/Sorry..)', out.casualOpener_real, out.casualOpener_cur);
row('first-person answer', out.firstPerson_real, out.firstPerson_cur);
row('formal 3P subject (The manager)', out.formalSubj_real, out.formalSubj_cur);
console.log('\nDISTRACTOR  real 0/14 rendered (NONE) | cur', out.distractor_cur.present+'/'+nC, pctOf(out.distractor_cur.present,nC), '| distinct', out.distractor_cur.distinct, '| top', JSON.stringify(out.distractor_cur.top.slice(0,6)));
console.log('CHUNKS(cur) eff-mean', out.chunks_cur.effMean, 'singleWord', out.chunks_cur.singleWordPct+'%', 'w/chunk', out.chunks_cur.meanWordsPerChunk, 'effHist', JSON.stringify(out.chunks_cur.effHist));
console.log('PREFILLED(cur) presence', pctOf(out.prefilled_cur.presence,nC), 'multiSeg', out.prefilled_cur.multiSegPct+'%', 'segWordMean', out.prefilled_cur.segWordMean, 'personHint', out.prefilled_cur.personHintPct+'%', 'nonZeroPos', out.prefilled_cur.nonZeroPosPct+'%');
console.log('PREFILLED(real, OCR clean n=40) presence ~85% | multiSeg ~21% | segWordMean ~1.46 | many END-tail + MID anchors (see doc)');
console.log('\nPROMPT real (n='+out.prompt_real.classified+' classified, '+out.prompt_real.unknown+' OCR-garbled): you/your', pctOf(out.prompt_real.you,out.prompt_real.classified), 'ends?', pctOf(out.prompt_real.q,out.prompt_real.classified));
console.log('  real openers', JSON.stringify(out.prompt_real.openers), '=>', `whatX ${pctOf(out.prompt_real.openers.whatX,out.prompt_real.classified)} / otherWh ${pctOf(out.prompt_real.openers.otherWh,out.prompt_real.classified)} / yesno ${pctOf(out.prompt_real.openers.yesno,out.prompt_real.classified)} / stmt ${pctOf(out.prompt_real.openers.statement,out.prompt_real.classified)}`);
console.log('PROMPT cur  you/your', pctOf(out.prompt_cur.you,nC), 'ends?', pctOf(out.prompt_cur.q,nC), 'openers', JSON.stringify(out.prompt_cur.openers));
console.log('\nDOMAIN real campus', pctOf(out.domain.real.campus,nRP), 'office', pctOf(out.domain.real.office,nRP), '| cur campus', pctOf(out.domain.cur.campus,nC), 'office', pctOf(out.domain.cur.office,nC));

// expose for require
export default out;
