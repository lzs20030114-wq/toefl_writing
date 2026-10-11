import fs from 'fs';
import path from 'path';
import os from 'os';
const bank = require('../data/realBank/reading/ap.json');
const review = require('../data/realBank/review-holds.json');
const restored = [['real_ap_225_2_11',11,'C'],['real_ap_311_1_31',31,'D'],['real_ap_320_1_31',34,'D'],['real_ap_316_2_11',13,'A'],['real_ap_510v2_2_11',15,'B']];
test.each(restored)('%s Q%s restores the exact source question once', (id, q, answer) => {
 const item = bank.items.find(x=>x.id===id);
 const matches = item.questions.filter(x=>x.q_number===q);
 expect(item.questions).toHaveLength(5);
 expect(matches).toHaveLength(1);
 expect(matches[0].correct_answer).toBe(answer);
 expect(Object.keys(matches[0].options)).toEqual(['A','B','C','D']);
 expect(review.holds.some(h=>h.id===id&&h.scope==='question'&&matches[0].stem.startsWith(h.stem))).toBe(false);
});
test('music source option correction replays twice without duplicating its prefix or changing answer', () => {
 const {applyReview}=require('../scripts/realbank/apply_review.mjs');
 const item=JSON.parse(JSON.stringify(bank.items.find(x=>x.id==='real_ap_510v2_2_11')));
 const patch=review.patches.find(p=>p.id===item.id&&p.path==='questions.4.options.C'&&p.source==='source-question-recovery-2026-10-11');
 expect(patch.op).toBe('set');
 item.questions[4].options.C='than music that expresses sorrow';
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ap-source-replay-'));
 try {
  const dir=path.join(temp,'data','realBank');
  for(const d of ['reading','listening','speaking'])fs.mkdirSync(path.join(dir,d),{recursive:true});
  const target=path.join(dir,'reading','ap.json');
  fs.writeFileSync(target,JSON.stringify({items:[item]}));
  fs.writeFileSync(path.join(dir,'review-holds.json'),JSON.stringify({holds:[],patches:[patch]}));
  expect(applyReview({root:temp}).stats.patched).toBe(1);
  const first=fs.readFileSync(target,'utf8');
  expect(JSON.parse(first).items[0]).toEqual(bank.items.find(x=>x.id===item.id));
  expect(applyReview({root:temp}).stats.patched).toBe(0);
  expect(fs.readFileSync(target,'utf8')).toBe(first);
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
test('historical Stoicism passage set preserves all four verified insert positions through final review', () => {
 const {applyReview}=require('../scripts/realbank/apply_review.mjs');
 const patch=review.patches.find(p=>p.id==='real_ap_128a_1_31'&&p.path==='passage'&&p.op==='set');
 expect(patch.to.match(/\[[A-D]\]/g)).toEqual(['[A]','[B]','[C]','[D]']);
 expect(patch.to).toContain('high-stakes negotiations. [B]');
 const item={id:patch.id,passage:patch.to,paragraphs:patch.to.split(/\n{2,}/),questions:[]};
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'stoic-marker-replay-'));
 try {
  const dir=path.join(temp,'data','realBank');
  for(const d of ['reading','listening','speaking'])fs.mkdirSync(path.join(dir,d),{recursive:true});
  const target=path.join(dir,'reading','ap.json');
  fs.writeFileSync(target,JSON.stringify({items:[item]}));
  fs.writeFileSync(path.join(dir,'review-holds.json'),JSON.stringify({holds:[],patches:[patch]}));
  applyReview({root:temp});
  const first=fs.readFileSync(target,'utf8');
  const actual=JSON.parse(first).items[0];
  expect(actual.passage).toBe(patch.to);
  expect(actual.paragraphs.join('\n\n').match(/\[[A-D]\]/g)).toEqual(['[A]','[B]','[C]','[D]']);
  applyReview({root:temp});
  expect(fs.readFileSync(target,'utf8')).toBe(first);
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
