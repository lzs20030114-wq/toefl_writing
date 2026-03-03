const fs = require('fs');
const text = fs.readFileSync('data/buildSentence/tpo_source.md', 'utf8');
const lines = text.split('\n');

const questions = [];
for (let i = 0; i < lines.length; i++) {
  const raw = lines[i];
  // Question lines look like: __1\.__ Were you able...
  if (/^__\d+\\?\.__/.test(raw)) {
    const prompt = raw.replace(/^__\d+\\?\.__\s*/, '').replace(/__/g, '').replace(/\\/g, '').trim();
    // Next non-empty line is the response with blanks, then the chunk line
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      const candidate = lines[j].trim();
      if (candidate.includes(' / ')) {
        const chunks = candidate.split(' / ').map(c => c.trim().toLowerCase());
        questions.push({ prompt, chunks, hasDid: chunks.includes('did') });
        break;
      }
    }
  }
}

console.log('TPO 原题解析题数:', questions.length);
const withDid = questions.filter(q => q.hasDid);
const pct = (withDid.length / questions.length * 100).toFixed(0);
console.log('chunks 中含 "did" 的题:', withDid.length + ' / ' + questions.length + ' (' + pct + '%)');
console.log();

console.log('=== 含 did 的题 ===');
withDid.forEach((q, i) => {
  console.log((i + 1) + '. ' + q.prompt);
  console.log('   ' + q.chunks.join(' / '));
});

console.log();
console.log('=== 各 chunk 中所有独特词频 (top 20) ===');
const freq = {};
questions.forEach(q => q.chunks.forEach(c => { freq[c] = (freq[c] || 0) + 1; }));
Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 20)
  .forEach(([k, v]) => console.log(v + '\t' + k));
