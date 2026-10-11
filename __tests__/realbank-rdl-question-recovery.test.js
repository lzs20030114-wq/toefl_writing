import fs from 'fs';
import path from 'path';
import os from 'os';

const root = path.join(__dirname, '..');
const review = JSON.parse(fs.readFileSync(path.join(root, 'data/realBank/review-holds.json'), 'utf8'));
const bank = JSON.parse(fs.readFileSync(path.join(root, 'data/realBank/reading/rdl.json'), 'utf8'));
// Independently read source screenshots: PDF pages 3,4,6,2,2,3,9 respectively.
const restored = [
  ['real_rdl_127a_1_21',21,'A'],
  ['real_rdl_418_1_25',26,'C'],
  ['real_rdl_310_1_28',30,'C'],
  ['real_rdl_32b_1_21',22,'C'],
  ['real_rdl_324_1_21',22,'B'],
  ['real_rdl_324_1_23',23,'C'],
  ['real_rdl_323_1_28',30,'D'],
];

test.each(restored)('%s Q%s retains its source answer and appears exactly once', (id,number,answer) => {
  const item=bank.items.find(i=>i.id===id);
  expect(item).toBeDefined();
  const qs=item.questions.filter(q=>q.q_number===number);
  expect(qs).toHaveLength(1);
  expect(qs[0].correct_answer).toBe(answer);
  expect(Object.keys(qs[0].options)).toEqual(['A','B','C','D']);
  expect(item.questions.map(q=>q.q_number)).toEqual([...item.questions.map(q=>q.q_number)].sort((a,b)=>a-b));
  expect(review.holds.some(h=>h.scope==='question'&&h.id.replace(/^real_ap_/,'real_rdl_')===id&&qs[0].stem.startsWith(h.stem))).toBe(false);
});

test('real source option repairs replay against raw OCR without changing answers or duplicating questions', () => {
  const {applyReview}=require('../scripts/realbank/apply_review.mjs');
  const repairs=[
    ['real_rdl_310_1_28',30,'D','Wednesday morning','Suggest that they compromise and speak on a Monday or Wednesday morning'],
    ['real_rdl_324_1_23',23,'A','by bringing their own environmentally-friendly bags to Student Housing stores','by bringing their own environmentally-friendly bags to stores'],
  ];
  const items=repairs.map(([id,number,letter,from,to])=>{
    const item=JSON.parse(JSON.stringify(bank.items.find(i=>i.id===id)));
    const idx=item.questions.findIndex(q=>q.q_number===number);
    expect(item.questions[idx].options[letter]).toBe(to);
    const patch=review.patches.find(p=>p.id===id&&p.path===`questions.${idx}.options.${letter}`&&p.to===to);
    expect(patch).toMatchObject({op:id.includes('_310_')?'set':'replace',to});
    item.questions[idx].options[letter]=from;
    return item;
  });
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rdl-source-replay-'));
  const dir=path.join(temp,'data','realBank');
  try {
    for(const d of ['reading','listening','speaking'])fs.mkdirSync(path.join(dir,d),{recursive:true});
    const target=path.join(dir,'reading','rdl.json');
    fs.writeFileSync(target,JSON.stringify({items}));
    fs.writeFileSync(path.join(dir,'review-holds.json'),JSON.stringify({holds:[],patches:review.patches.filter(p=>repairs.some(r=>r[0]===p.id))}));
    expect(applyReview({root:temp}).stats.patched).toBe(2);
    const first=fs.readFileSync(target,'utf8');
    expect(JSON.parse(first).items).toEqual(repairs.map(r=>bank.items.find(i=>i.id===r[0])));
    expect(applyReview({root:temp}).stats.patched).toBe(0);
    expect(fs.readFileSync(target,'utf8')).toBe(first);
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});

test.each([
  ['2.2新托福真题','real_rdl_22_1_22',21,'A','C'],
  ['4.28新托福真题','real_rdl_428_1_21',22,'D','B'],
  ['5.10新托福真题','real_rdl_510_1_22',21,'D','C'],
])('%s Q%s source correction requires both existing votes and exact location', (set,id,number,oldAnswer,answer) => {
  const {manualAnswerFix}=require('../scripts/realbank/hold_policy');
  const entries=JSON.parse(fs.readFileSync(path.join(root,'data/realBank/audit-overrides.json'),'utf8')).entries;
  const item=bank.items.find(i=>i.id===id);
  const qs=item.questions.filter(q=>q.q_number===number);
  expect(qs).toHaveLength(1);
  expect(qs[0].correct_answer).toBe(answer);
  expect(qs[0].correct_answer).not.toBe(oldAnswer);
  const at={set,section:'reading',module:1,q:number,stamped:oldAnswer,stem:qs[0].stem,votes:[answer,answer]};
  expect(manualAnswerFix(entries,at)).toBe(answer);
  expect(manualAnswerFix(entries,{...at,votes:[answer,oldAnswer]})).toBeNull();
  expect(manualAnswerFix(entries,{...at,votes:[answer]})).toBeNull();
  expect(manualAnswerFix(entries,{...at,module:2})).toBeNull();
  expect(manualAnswerFix(entries,{...at,stamped:answer})).toBeNull();
});

test('rp0822 three questions retain the source course image content and unique original keys', () => {
  const item=bank.items.find(i=>i.id==='real_rdl_rp0822_1001_100101');
  expect(item).toBeDefined();
  for(const phrase of ['New Winter Term Writing Seminar','newly developed Creative Writing Seminar','narrative structure','character development','dialogue crafting','interactive exercises and group readings','one first-year-level course','Creative Writing or English department'])expect(item.text).toContain(phrase);
  expect(item.text).not.toMatch(/^Questions\s+Refer to the course description/);
  expect(item.questions.map(q=>q.q_number)).toEqual([100101,100102,100103]);
  expect(item.questions.map(q=>q.correct_answer)).toEqual(['A','C','B']);
  const repairs=JSON.parse(fs.readFileSync(path.join(root,'data/realBank/reading/source-repairs.json'),'utf8')).entries;
  for(const number of [100101,100102,100103]){
    const repair=repairs.find(e=>e.set==='rp0822'&&e.q===number);
    expect(repair).toBeDefined();
    expect(repair.evidence.verified).toBe(true);
  }
});
