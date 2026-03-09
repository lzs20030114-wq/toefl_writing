const fs = require('fs');
const lines = fs.readFileSync('scripts/generateBSQuestions.mjs', 'utf8').split('\n');

// Lines 542-548 (indices 541-547, 7 lines): replace with clean version
// no specific topic nouns that plant scenario ideas
var n542 = lines[541];
if (!n542.includes('Examples WITH correct prefilled')) {
  console.error('Line 542 mismatch: ' + n542.slice(0, 80));
  process.exit(1);
}
console.log('OK: found examples section at line 542');

var newEx = [
  'Examples WITH correct prefilled (the 2-word opener, NEVER the embedded topic noun):',
  '  answer: "Could you tell me how you are feeling about it?"  prefilled=["could you"] pos=0',
  '  answer: "Can you remind me when that event was rescheduled?"  prefilled=["can you"] pos=0',
  '  answer: "Do you know what time it opens on Sundays?"  prefilled=["do you"] pos=0',
  '  CRITICAL: the 2-word opener is ALWAYS prefilled. NEVER a noun phrase inside the clause.',
  'Distractor: morphological variant or nearby auxiliary/modal variant.',
];
lines.splice(541, 7, ...newEx);
var shift = newEx.length - 7; // 6 - 7 = -1
console.log('Replaced 7 lines with 6 lines (shift=' + shift + ')');

// Find and fix PREFILLED note
var pfIdx = -1;
for (var i = 545; i < 560; i++) {
  if (lines[i] && lines[i].includes('PREFILLED (medium/easy): ALWAYS use the 2-word')) {
    pfIdx = i;
    break;
  }
}
if (pfIdx < 0) { console.error('PREFILLED note not found in range 546-560'); process.exit(1); }
console.log('PREFILLED note at line ' + (pfIdx + 1));

var pfLine = lines[pfIdx];
var bi = pfLine.lastIndexOf('`');
lines[pfIdx] =
  'PREFILLED (medium/easy): ALWAYS use the 2-word opening frame as prefilled: ' +
  '["could you"], ["can you"], ["do you"], ["would you"]. ' +
  'NEVER any noun phrase from the embedded clause as prefilled.' +
  pfLine.slice(bi);
console.log('PREFILLED note updated');

fs.writeFileSync('scripts/generateBSQuestions.mjs', lines.join('\n'), 'utf8');
console.log('\nWritten. Verifying...');

const r = fs.readFileSync('scripts/generateBSQuestions.mjs', 'utf8');
[
  ['next showing', false],
  ['department meeting', false],
  ['new policy', false],
  ['library closes on Sundays', false],
  ['CRITICAL: the 2-word opener is ALWAYS prefilled', true],
  ['NEVER any noun phrase from the embedded clause', true],
].forEach(function(pair) {
  var found = r.includes(pair[0]);
  var ok = found === pair[1];
  console.log((ok ? 'OK' : 'FAIL') + ': "' + pair[0].slice(0, 55) + '" ' + (pair[1] ? 'present' : 'absent'));
});
