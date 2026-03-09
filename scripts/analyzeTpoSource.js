const fs = require('fs');
const raw = fs.readFileSync('data/buildSentence/tpo_source.md', 'utf8');

// Split into lines and find question blocks
// A question starts with __N.__ pattern
const lines = raw.split('\n');

let questions = [];
let current = null;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();

  // Detect question number line: __1.__ or __10.__
  const qMatch = line.match(/^__(\d+)\\?\.__\s+(.*)/);
  if (qMatch) {
    if (current) questions.push(current);
    current = {
      num: parseInt(qMatch[1]),
      prompt: qMatch[2].replace(/\\_/g, '_').replace(/\\/g, ''),
      answerLine: '',
      chunks: [],
      prefilled: [],
    };
    continue;
  }

  if (!current) continue;

  // Answer line: contains blanks _____ and potentially given words
  // Blank pattern: \_\_\_\_\_ or ______
  if (line.includes('\\_\\_\\_') || line.includes('_____')) {
    current.answerLine += ' ' + line;
    continue;
  }

  // Chunks line: words separated by / at bottom
  if (line.includes(' / ') || (line.match(/^[a-z]/) && line.includes('/'))) {
    current.chunks = line.split('/').map(s => s.trim()).filter(Boolean);
    continue;
  }
}
if (current) questions.push(current);

console.log('Total questions found:', questions.length);
console.log('');

// Now analyze prefilled: words that appear in the answer template but are NOT blank
// The answer line has _____ for blanks and actual words for prefilled
let withPrefilled = 0;
let noPrefilled = 0;
const details = [];

questions.forEach(function(q) {
  const ans = q.answerLine.trim();
  if (!ans) return;

  // Find non-blank tokens in the answer line
  // Blanks are: \_\_\_\_\_ or _____ (5+ underscores)
  const cleaned = ans
    .replace(/\\_/g, '_')
    .replace(/\\/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Split by blank pattern (sequences of underscores)
  const parts = cleaned.split(/_{3,}/);

  // Non-blank parts: trim, filter empty, ignore punctuation-only
  const nonBlank = parts
    .map(p => p.trim().replace(/^[.,?!;:\s]+|[.,?!;:\s]+$/g, '').trim())
    .filter(p => p.length > 0 && !/^[.,?!;:]+$/.test(p));

  const hasPrefilled = nonBlank.length > 0;
  if (hasPrefilled) {
    withPrefilled++;
    details.push({
      num: q.num,
      prefilled: nonBlank,
      ans: cleaned.slice(0, 80),
    });
  } else {
    noPrefilled++;
  }
});

console.log('With prefilled:   ' + withPrefilled + '/' + questions.length +
  ' (' + Math.round(withPrefilled / questions.length * 100) + '%)');
console.log('Without prefilled:' + noPrefilled + '/' + questions.length +
  ' (' + Math.round(noPrefilled / questions.length * 100) + '%)');

console.log('\nPrefilled items:');
details.forEach(function(d) {
  console.log('  Q' + d.num + ': ' + JSON.stringify(d.prefilled) + ' | ' + d.ans);
});
