const fs = require('fs');
const lines = fs.readFileSync('scripts/generateBSQuestions.mjs', 'utf8').split('\n');

function verify(n, substr, label) {
  if (!lines[n - 1] || !lines[n - 1].includes(substr)) {
    console.error('FAIL ' + n + ' [' + label + ']: ' + (lines[n-1]||'').slice(0, 80));
    process.exit(1);
  }
  console.log('OK ' + n + ': ' + label);
}

verify(449, 'SCORER FENCE (medium)', 'negation medium scorer fence');
verify(475, 'SCORER FENCE (medium)', '3rd-reporting medium scorer fence');
verify(506, 'SCORER FENCE (medium)', '1st-embedded medium scorer fence');
verify(539, 'SCORER FENCE (medium)', 'interrogative medium scorer fence');
verify(558, 'sells/sold', 'direct medium closing line');
verify(576, 'stopped/stop', 'relative medium closing line');

console.log('\nAll OK. Patching...\n');

// Append PREFILLED note before the closing backtick in a line
function appendBeforeClose(n, note) {
  var line = lines[n - 1];
  var idx = line.lastIndexOf('`');
  if (idx < 0) { console.error('No backtick at line ' + n); process.exit(1); }
  lines[n - 1] = line.slice(0, idx) + '\n' + note + line.slice(idx);
  console.log('Patched line ' + n);
}

appendBeforeClose(449,
  'PREFILLED (medium/easy): negation answers are always 1st-person. Use prefilled=["i"] at position 0. ' +
  'NEVER use ["not"] as prefilled \u2014 "not" is part of the draggable chunks.');

appendBeforeClose(475,
  'PREFILLED (medium/easy): 3rd-person answers \u2014 use the SUBJECT as prefilled. ' +
  'Single pronoun: ["she"] or ["he"]. 2-word subject NP: ["the manager"], ["the professor"]. ' +
  'NOT the object noun phrase.');

appendBeforeClose(506,
  'PREFILLED (medium/easy): 1st-embedded answers are always 1st-person. ' +
  'Use prefilled=["i"] at position 0. Simplest and most authentic.');

appendBeforeClose(539,
  'PREFILLED (medium/easy): use the 2-word opening question frame as prefilled: ' +
  '["could you"], ["can you"], ["do you"]. Always at positions 0-1. ' +
  'This anchors the opener and leaves the embedded clause as draggable chunks.');

appendBeforeClose(558,
  'PREFILLED (medium): use the SUBJECT as prefilled. ' +
  '1st-person answers: ["i"]. 3rd-person: 2-word subject NP like ["the store"], ["the professor"]. ' +
  'NOT the object.');

appendBeforeClose(576,
  'PREFILLED (medium): use the SUBJECT as prefilled. ' +
  'Contact clause: subject NP like ["the bookstore"], ["the diner"]. ' +
  '1st-person: ["i"]. NOT the object inside the relative clause.');

fs.writeFileSync('scripts/generateBSQuestions.mjs', lines.join('\n'), 'utf8');
console.log('\nWritten. Verifying...');

const r = fs.readFileSync('scripts/generateBSQuestions.mjs', 'utf8');
[
  ['PREFILLED (medium/easy): negation', 'negation medium prefilled'],
  ['PREFILLED (medium/easy): 3rd-person', '3rd-reporting medium prefilled'],
  ['PREFILLED (medium/easy): 1st-embedded', '1st-embedded medium prefilled'],
  ['PREFILLED (medium/easy): use the 2-word opening', 'interrogative medium prefilled'],
  ['PREFILLED (medium): use the SUBJECT as prefilled. 1st-person', 'direct medium prefilled'],
  ['PREFILLED (medium): use the SUBJECT as prefilled. Contact', 'relative medium prefilled'],
].forEach(function(pair) {
  console.log((r.includes(pair[0]) ? 'OK' : 'MISSING') + ': ' + pair[1]);
});
