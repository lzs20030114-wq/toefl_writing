const fs = require('fs');
const path = require('path');

// ── Part 1: Analyze TPO source ──
const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'buildSentence', 'tpo_source.md'), 'utf8');
const lines = raw.split(/\r?\n/);

const questions = [];
let current = null;
let setNum = 0;

for (const line of lines) {
  if (/第.*套|下一套|Pack/.test(line)) { setNum++; continue; }
  const qm = line.match(/^__(\d+)\\.?__\s*(.*)/);
  if (qm) {
    if (current && current.template) questions.push(current);
    current = { set: setNum, num: qm[1], prompt: qm[2], template: '', chunks: '' };
    continue;
  }
  if (!current) continue;
  if (line.includes('\\_')) {
    current.template += (current.template ? ' ' : '') + line.trim();
    continue;
  }
  if (line.includes(' / ') && !line.startsWith('__')) {
    current.chunks = line.trim();
  }
}
if (current && current.template) questions.push(current);

console.log('TPO questions parsed:', questions.length);

// Analyze each question's prefilled position
questions.forEach((q) => {
  let t = q.template
    .replace(/\\_/g, '_')
    .replace(/\\\./g, '.')
    .replace(/\s+/g, ' ')
    .trim();

  // Split by blank groups (3+ underscores)
  const parts = t.split(/_{3,}/);

  const givenParts = [];
  parts.forEach((p, pi) => {
    const cleaned = p.replace(/[.?!,;:]/g, '').trim();
    if (cleaned) {
      let pos = 'MID';
      if (pi === 0) pos = 'START';
      if (pi === parts.length - 1) pos = 'END';
      givenParts.push({ text: cleaned, pos, words: cleaned.split(/\s+/).length });
    }
  });

  q.givenParts = givenParts;
  q.posType = givenParts.length === 0
    ? 'NONE'
    : [...new Set(givenParts.map(g => g.pos))].sort().join('+');
});

// Summary
const posCounts = {};
questions.forEach(q => { posCounts[q.posType] = (posCounts[q.posType] || 0) + 1; });
console.log('\n=== TPO Prefilled Position Distribution ===');
Object.entries(posCounts).sort((a, b) => b[1] - a[1]).forEach(([pos, count]) => {
  console.log('  ' + pos.padEnd(15) + count + '/' + questions.length + ' (' + Math.round(count / questions.length * 100) + '%)');
});

// Count by given word count
const wordCounts = { 1: 0, 2: 0, 3: 0, '4+': 0 };
const startGiven = [];
const midGiven = [];
const endGiven = [];
questions.forEach(q => {
  q.givenParts.forEach(g => {
    const wc = g.words;
    if (wc >= 4) wordCounts['4+']++;
    else wordCounts[wc]++;
    if (g.pos === 'START') startGiven.push(g.text);
    if (g.pos === 'MID') midGiven.push(g.text);
    if (g.pos === 'END') endGiven.push(g.text);
  });
});

console.log('\n=== TPO Prefilled Word Counts (all given segments) ===');
Object.entries(wordCounts).forEach(([wc, count]) => {
  const total = startGiven.length + midGiven.length + endGiven.length;
  console.log('  ' + wc + '-word: ' + count + ' (' + Math.round(count / total * 100) + '%)');
});

// Detail
console.log('\n=== TPO Detail ===');
questions.forEach((q) => {
  const given = q.givenParts.map(g => '"' + g.text + '"(' + g.pos + ',' + g.words + 'w)').join(' + ') || '-';
  console.log('S' + q.set + 'Q' + q.num.padStart(2) + ' [' + q.posType.padEnd(12) + '] ' + given);
});

// ── Part 2: Analyze our question bank ──
console.log('\n\n========================================');
console.log('=== OUR QUESTION BANK ANALYSIS ===');
console.log('========================================');

const bankData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'buildSentence', 'questions.json'), 'utf8'));
const sets = bankData.question_sets || [];
const allQ = sets.flatMap(s => s.questions || []);

console.log('Total questions in bank:', allQ.length);

// For each question, determine prefilled position
let bankStart = 0, bankMid = 0, bankEnd = 0, bankNone = 0, bankStartEnd = 0;
const bankPosCounts = {};
const bankPfWordCounts = { 1: 0, 2: 0, 3: 0, '4+': 0 };
const bankPfTexts = [];

allQ.forEach(q => {
  const pf = Array.isArray(q.prefilled) ? q.prefilled : [];
  const pfPos = q.prefilled_positions || {};

  if (pf.length === 0 || Object.keys(pfPos).length === 0) {
    bankPosCounts['NONE'] = (bankPosCounts['NONE'] || 0) + 1;
    return;
  }

  const answerWords = (q.answer || '').toLowerCase().replace(/[.,!?;:]/g, '').split(/\s+/).filter(Boolean);
  const totalWords = answerWords.length;

  const positions = [];
  for (const [chunk, pos] of Object.entries(pfPos)) {
    const chunkWords = chunk.trim().split(/\s+/).length;
    const wc = chunkWords;
    if (wc >= 4) bankPfWordCounts['4+']++;
    else bankPfWordCounts[wc]++;
    bankPfTexts.push(chunk.trim().toLowerCase());

    // Determine position category
    const wordPos = Number(pos);
    if (wordPos === 0) {
      positions.push('START');
    } else if (wordPos + chunkWords >= totalWords) {
      positions.push('END');
    } else {
      positions.push('MID');
    }
  }

  const posType = [...new Set(positions)].sort().join('+');
  bankPosCounts[posType] = (bankPosCounts[posType] || 0) + 1;
});

console.log('\n=== Our Bank: Prefilled Position Distribution ===');
Object.entries(bankPosCounts).sort((a, b) => b[1] - a[1]).forEach(([pos, count]) => {
  console.log('  ' + pos.padEnd(15) + count + '/' + allQ.length + ' (' + Math.round(count / allQ.length * 100) + '%)');
});

console.log('\n=== Our Bank: Prefilled Word Counts ===');
const bankPfTotal = Object.values(bankPfWordCounts).reduce((a, b) => a + b, 0);
Object.entries(bankPfWordCounts).forEach(([wc, count]) => {
  console.log('  ' + wc + '-word: ' + count + ' (' + Math.round(count / (bankPfTotal || 1) * 100) + '%)');
});

// Top prefilled texts
const pfFreq = {};
bankPfTexts.forEach(t => { pfFreq[t] = (pfFreq[t] || 0) + 1; });
console.log('\n=== Our Bank: Top 15 Prefilled Texts ===');
Object.entries(pfFreq).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([text, count]) => {
  console.log('  "' + text + '": ' + count);
});

// ── Part 3: Comparison table ──
console.log('\n\n========================================');
console.log('=== COMPARISON: TPO vs Our Bank ===');
console.log('========================================');

const allPos = new Set([...Object.keys(posCounts), ...Object.keys(bankPosCounts)]);
console.log('Position'.padEnd(15) + 'TPO'.padStart(12) + 'Our Bank'.padStart(12));
console.log('-'.repeat(39));
[...allPos].sort().forEach(pos => {
  const tpoVal = posCounts[pos] || 0;
  const bankVal = bankPosCounts[pos] || 0;
  const tpoPct = Math.round(tpoVal / questions.length * 100) + '%';
  const bankPct = Math.round(bankVal / allQ.length * 100) + '%';
  console.log(pos.padEnd(15) + (tpoVal + ' (' + tpoPct + ')').padStart(12) + (bankVal + ' (' + bankPct + ')').padStart(12));
});
