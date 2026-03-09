const fs = require('fs');
const lines = fs.readFileSync('scripts/generateBSQuestions.mjs', 'utf8').split('\n');

function verify(n, substr, label) {
  if (!lines[n - 1] || !lines[n - 1].includes(substr)) {
    console.error('FAIL ' + n + ' [' + label + ']: ' + (lines[n-1]||'').slice(0, 80));
    process.exit(1);
  }
  console.log('OK ' + n + ': ' + label);
}

verify(441, 'SCORER FENCE (easy)', 'negation easy scorer fence');
verify(444, 'Examples:', 'negation medium examples header');
verify(450, 'PREFILLED (medium/easy): negation answers', 'negation medium PREFILLED note');

console.log('\nAll OK. Patching...\n');

// ── Patch 1: Add PREFILLED note to easy hint (line 441) ──────────────────────
var easy = lines[440];
var idx = easy.lastIndexOf('`');
lines[440] = easy.slice(0, idx) +
  '\nPREFILLED (easy): Use prefilled=["i"] at position 0. NEVER ["not"].' +
  easy.slice(idx);
console.log('Patch 1: negation easy PREFILLED note added');

// ── Patch 2: Replace medium examples (lines 444-448, 5 lines) ────────────────
verify(444, 'Examples:', 'medium examples header pre-patch2');
var newExamples = [
  'Examples WITH correct prefilled (study these carefully):',
  '  answer: "I did not understand what the manager explained."  prefilled=["i"] pos=0 \u2714',
  '  answer: "I have not received any confirmation about the schedule."  prefilled=["i"] pos=0 \u2714',
  '  answer: "He did not know why the meeting was postponed."  prefilled=["he"] pos=0 \u2714',
  '  BAD: prefilled=["not"] on ANY negation sentence \u2014 WRONG \u2718  Use subject pronoun instead.',
  'Prompt: direct question or narrative context. Distractor: "did"/"do" or morphological variant.',
];
lines.splice(443, 5, ...newExamples);
var shift = newExamples.length - 5; // 6 - 5 = +1
console.log('Patch 2: negation medium examples annotated (shift=+' + shift + ')');

// ── Patch 3: Update PREFILLED note (now at 451 after shift) ──────────────────
var pfLine = 450 + shift; // 451
verify(pfLine, 'PREFILLED (medium/easy): negation answers', 'negation PREFILLED note post-shift');
var line = lines[pfLine - 1];
var bi = line.lastIndexOf('`');
var newPf =
  'PREFILLED (medium/easy): ALL negation answers use the SUBJECT pronoun as prefilled. ' +
  '1st-person ("I did not..."): prefilled=["i"] at position 0. ' +
  '3rd-person ("He/She did not..."): prefilled=["he"] or ["she"] at position 0. ' +
  'NEVER use ["not"] as prefilled \u2014 "not" belongs in chunks, not in prefilled.';
lines[pfLine - 1] = newPf + line.slice(bi);
console.log('Patch 3: PREFILLED note covers 3rd-person negation');

// ── Write & verify ────────────────────────────────────────────────────────────
fs.writeFileSync('scripts/generateBSQuestions.mjs', lines.join('\n'), 'utf8');
console.log('\nWritten. Verifying...');

const r = fs.readFileSync('scripts/generateBSQuestions.mjs', 'utf8');
[
  ['PREFILLED (easy): Use prefilled=["i"] at position 0. NEVER ["not"].', 'easy PREFILLED note'],
  ['study these carefully', 'annotated examples header'],
  ['prefilled=["he"] pos=0', 'he example'],
  ['BAD: prefilled=["not"] on ANY negation', 'BAD example'],
  ['3rd-person ("He/She did not...")', '3rd-person coverage'],
].forEach(function(pair) {
  console.log((r.includes(pair[0]) ? 'OK' : 'MISSING') + ': ' + pair[1]);
});
