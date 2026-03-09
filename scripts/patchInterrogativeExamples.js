const fs = require('fs');
const lines = fs.readFileSync('scripts/generateBSQuestions.mjs', 'utf8').split('\n');

// Verify
function verify(n, substr, label) {
  if (!lines[n-1] || !lines[n-1].includes(substr)) {
    console.error('FAIL ' + n + ' [' + label + ']: ' + (lines[n-1]||'').slice(0, 80));
    process.exit(1);
  }
  console.log('OK ' + n + ': ' + label);
}

verify(542, 'Examples WITH correct prefilled', 'interrogative examples header');
verify(547, 'Distractor:', 'distractor line');
verify(550, 'PREFILLED (medium/easy): ALWAYS use the 2-word', 'interrogative PREFILLED note');

console.log('\nAll OK. Patching...\n');

// Replace lines 542-547 (indices 541-546, 6 lines) with cleaner version
// No specific topic nouns that could plant scenario ideas
var newEx = [
  'Examples WITH correct prefilled (the 2-word opener, NEVER the embedded topic noun):',
  '  answer: "Could you tell me how you are feeling about it?"  prefilled=["could you"] pos=0 \u2714',
  '  answer: "Can you remind me when that event was rescheduled?"  prefilled=["can you"] pos=0 \u2714',
  '  answer: "Do you know what time it opens on Sundays?"  prefilled=["do you"] pos=0 \u2714',
  '  CRITICAL: prefilled is ALWAYS the 2-word opener. NEVER any noun inside the clause.',
  'Distractor: morphological variant or nearby auxiliary/modal variant.',
];
lines.splice(541, 6, ...newEx);
var shift = newEx.length - 6; // 0
console.log('Patch 1: interrogative examples replaced (shift=' + shift + ')');

// Update PREFILLED note (still at 550 + shift = 550) — remove specific topic nouns
verify(550, 'PREFILLED (medium/easy): ALWAYS use the 2-word', 'PREFILLED note post-patch1');
var pfLine = lines[549];
var bi = pfLine.lastIndexOf('`');
lines[549] =
  'PREFILLED (medium/easy): ALWAYS use the 2-word opening frame as prefilled: ["could you"], ["can you"], ["do you"]. ' +
  'NEVER use any noun phrase from the embedded clause as prefilled. ' +
  'The opener anchors the sentence; the embedded clause stays fully draggable.' +
  pfLine.slice(bi);
console.log('Patch 2: PREFILLED note cleaned (no specific topic nouns)');

fs.writeFileSync('scripts/generateBSQuestions.mjs', lines.join('\n'), 'utf8');
console.log('\nWritten. Verifying...');

const r = fs.readFileSync('scripts/generateBSQuestions.mjs', 'utf8');
[
  ['next showing', false],
  ['department meeting', false],
  ['new policy', false],
  ['CRITICAL: prefilled is ALWAYS the 2-word opener', true],
  ['NEVER any noun phrase from the embedded clause', true],
].forEach(function(pair) {
  var found = r.includes(pair[0]);
  var expected = pair[1];
  var ok = found === expected;
  console.log((ok ? 'OK' : 'FAIL') + ': ' + pair[0].slice(0, 60) + (expected ? ' present' : ' removed'));
});
