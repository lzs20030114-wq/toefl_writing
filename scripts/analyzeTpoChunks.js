const fs = require('fs');
const text = fs.readFileSync('./data/buildSentence/tpo_source.md', 'utf8');

// Clean markdown escapes
const lines = text.split('\n').map(l =>
  l.replace(/\\\\/g, '')
   .replace(/\\_/g, '_')
   .replace(/\\\./g, '.')
   .replace(/\\!/g, '!')
   .replace(/\\\?/g, '?')
   .replace(/\\\-/g, '-')
   .trim()
);

const questions = [];
let i = 0;
while (i < lines.length) {
  if (/^__\d+\.__/.test(lines[i])) {
    const prompt = lines[i].replace(/__\d+\.__\s*/, '').replace(/__/g, '').trim();

    let answerLines = [];
    let bankLine = '';
    i++;
    while (
      i < lines.length &&
      !/^__\d+\.__/.test(lines[i]) &&
      !/^__TPO/.test(lines[i]) &&
      !/^__第/.test(lines[i]) &&
      !/^__下一套/.test(lines[i])
    ) {
      const l = lines[i].trim();
      if (l.includes('/') && !l.includes('____') && l.length > 3) {
        bankLine = l;
      } else if (l.includes('____') || (answerLines.length > 0 && l && !l.startsWith('__'))) {
        if (l) answerLines.push(l);
      }
      i++;
    }

    if (bankLine && answerLines.length > 0) {
      const answerText = answerLines.join(' ');
      const blanks = (answerText.match(/____+/g) || []).length;
      const bank = bankLine.split('/').map(s => s.trim()).filter(Boolean);
      const bankTotal = bank.length;
      const multiWord = bank.filter(s => s.split(/\s+/).length > 1).length;
      const hasDistractor = bankTotal > blanks;
      const effectiveChunks = blanks;

      questions.push({ prompt, blanks, bankTotal, effectiveChunks, multiWord, hasDistractor, bank });
    }
  } else {
    i++;
  }
}

console.log('Total TPO questions parsed:', questions.length);
console.log('');

const avgEffective = questions.reduce((s, q) => s + q.effectiveChunks, 0) / questions.length;
const avgBank = questions.reduce((s, q) => s + q.bankTotal, 0) / questions.length;
const totalChunks = questions.reduce((s, q) => s + q.bankTotal, 0);
const totalMulti = questions.reduce((s, q) => s + q.multiWord, 0);
const withDistractor = questions.filter(q => q.hasDistractor).length;

console.log('=== CHUNK COUNT STATS ===');
console.log('Avg effective chunks (blanks):', avgEffective.toFixed(2));
console.log('Avg bank items (incl. distractor):', avgBank.toFixed(2));
console.log('With distractor:', withDistractor + '/' + questions.length, '(' + Math.round(withDistractor / questions.length * 100) + '%)');
console.log('');
console.log('=== MULTI-WORD CHUNK STATS ===');
console.log('Total bank items:', totalChunks);
console.log('Multi-word bank items:', totalMulti, '(' + Math.round(totalMulti / totalChunks * 100) + '%)');
console.log('Single-word bank items:', (totalChunks - totalMulti), '(' + Math.round((totalChunks - totalMulti) / totalChunks * 100) + '%)');
console.log('');

const dist = {};
questions.forEach(q => { dist[q.effectiveChunks] = (dist[q.effectiveChunks] || 0) + 1; });
console.log('=== EFFECTIVE CHUNKS DISTRIBUTION ===');
Object.keys(dist).sort((a, b) => +a - +b).forEach(k => {
  const bar = '#'.repeat(dist[k]);
  console.log('  ' + k + ' chunks: ' + dist[k] + ' qs (' + Math.round(dist[k] / questions.length * 100) + '%) ' + bar);
});

console.log('');
console.log('=== ALL QUESTIONS DETAIL ===');
questions.forEach((q, i) => {
  const multiPct = Math.round(q.multiWord / q.bankTotal * 100);
  console.log((i + 1) + '. blanks=' + q.effectiveChunks + ' bank=' + q.bankTotal + ' multi=' + q.multiWord + '(' + multiPct + '%) dist=' + q.hasDistractor);
  const multiItems = q.bank.filter(s => s.split(/\s+/).length > 1);
  if (multiItems.length > 0) console.log('   multi-word: [' + multiItems.join(' | ') + ']');
});
