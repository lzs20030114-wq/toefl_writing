const fs = require('fs');
const content = fs.readFileSync('scripts/generateBSQuestions.mjs', 'utf8');
const lines = content.split('\n');

const REMINDER = 'PREFILLED REMINDER: Hard sentences are 10-13 words — chunks MUST still be ≤ 8. Use a 2-3 word noun phrase as prefilled so R = answer_words - prefilled_words ≤ 8. Example: answer=11 words, prefilled=["the final report"] (3 words) -> R=8 -> 7 chunks + distractor. Difficulty comes from GRAMMAR STRUCTURE, not from chunk count.';

// Hard hint ending lines (lines with Distractor that are inside hard blocks)
// We identify them by looking for lines that end a hard block (backtick after distractor line)
// The hard blocks end with a line like: `Distractor: ...`,  (backtick at end)
const hardDistractorLines = [
  460, // negation/hard
  487, // 3rd-reporting/hard
  516, // 1st-embedded/hard
  548, // interrogative/hard
  565, // direct/hard
  581, // relative/hard
];

// Insert REMINDER before the closing backtick of each hard block
// Working backwards to preserve line numbers
hardDistractorLines.slice().reverse().forEach(function(lineNum) {
  const idx = lineNum - 1; // 0-indexed
  const line = lines[idx];
  // The distractor line ends with: .`,   or  .`
  // We insert the REMINDER as a new line before this distractor line's closing backtick
  // Actually easier: just append to the distractor line before the closing backtick
  if (line.endsWith('`,')) {
    lines[idx] = line.slice(0, -2) + '\n' + REMINDER + '`,';
  } else if (line.endsWith('`')) {
    lines[idx] = line.slice(0, -1) + '\n' + REMINDER + '`';
  } else {
    console.log('WARNING: line', lineNum, 'does not end with backtick:', line.slice(-10));
  }
  console.log('Patched line', lineNum, ':', line.slice(0, 60) + '...');
});

fs.writeFileSync('scripts/generateBSQuestions.mjs', lines.join('\n'), 'utf8');
console.log('\nDone. Verifying PREFILLED REMINDER count:');
const result = fs.readFileSync('scripts/generateBSQuestions.mjs', 'utf8');
const count = (result.match(/PREFILLED REMINDER/g) || []).length;
console.log('PREFILLED REMINDER occurrences:', count, '(expected 6)');
