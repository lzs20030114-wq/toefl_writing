const fs = require('fs');
const lines = fs.readFileSync('scripts/generateBSQuestions.mjs', 'utf8').split('\n');

function verify(n, substr, label) {
  if (!lines[n - 1].includes(substr)) {
    console.error('FAIL line ' + n + ' [' + label + ']: expected "' + substr + '"\n  got: ' + lines[n - 1].slice(0, 100));
    process.exit(1);
  }
  console.log('OK ' + n + ': ' + label);
}

// Absolute line numbers (verified from grep above)
verify(665, '3-4 items with prefilled=[] is natural', 'TARGET prefilled rate line');
verify(678, 'prefer 1-3 word noun phrases', 'RULE prefer 1-3 word');
verify(697, 'Target R = 6-7', 'Target R line');
verify(698, 'HARD RULE: answer', 'HARD RULE line');
verify(699, 'prefilled=["not"] on a 9+ word', 'not invalid line');
verify(700, 'If R > 8', 'R > 8 line');
verify(701, 'If R', 'R <= 5 line');
verify(809, 'CHUNK GRANULARITY & R-VALUE', 'checklist item 5');

console.log('\nAll OK. Patching...\n');

// ── Patch 1: TARGET rate line (665) — clarify prefilled=[] only for ≤8w ──
lines[664] =
  '- TARGET: about 6-7 out of 10 items should have a non-empty prefilled (~67%). ' +
  'prefilled=[] is ONLY valid when the answer is \u22648 words. ' +
  'Answers \u22659 words MUST have a non-empty prefilled.';
console.log('Patch 1: TARGET line updated (no-prefilled only for ≤8w)');

// ── Patch 2: RULE prefer 1-3 word (678) → prefer 2-word ──────────────────
lines[677] =
  'RULE: prefilled must appear EXACTLY ONCE in the answer (avoids position ambiguity).' +
  '\nRULE: STRONGLY PREFER 2-word noun phrases. Examples: "the store", "the report", "the meeting", "the project".' +
  '\n  - Use 2-word when possible: "the meeting" not "the weekly meeting", "the report" not "the final report".' +
  '\n  - Use 3-word ONLY when the 2-word form is ambiguous or absent in the sentence.' +
  '\n  - NEVER use 4-word+ prefilled. Shorten to the core 2-word noun phrase instead.';
console.log('Patch 2: RULE prefer 2-word added');

// After patch 2 the line we inserted has \n in it (stays as 1 array element, no shift)

// ── Patch 3: HARD RULE section — add HARD RULE 2 for no-prefilled ─────────
// Lines 698-701 in the original. Still at same positions since patches above
// didn't change array length.
// Replace the existing HARD RULE block (lines 698-700, 3 lines) with expanded version
verify(698, 'HARD RULE: answer', 'HARD RULE line pre-patch3');
verify(699, 'prefilled=["not"] on a 9+ word', 'not invalid pre-patch3');
verify(700, 'If R > 8', 'R>8 pre-patch3');

const newRSection = [
  '- HARD RULE 1: answer \u22659 words \u2192 prefilled MUST be \u22652 words.',
  '  prefilled=["not"] on a 9+ word answer is INVALID \u2014 use a 2-word object noun phrase instead.',
  '  prefilled=[] on a 9+ word answer is INVALID \u2014 add a 2-word noun phrase prefilled.',
  '- HARD RULE 2: prefilled length MUST be 2 words for most items.',
  '  Use 2-word: "the report", "the meeting", "the store", "the project", "the policy".',
  '  Allowed exceptions: 3-word only when 2-word is genuinely ambiguous. NEVER 4-word+.',
  '- If R > 8: shorten the sentence OR add a 2-word noun-phrase prefilled to bring R \u22648.',
];
// Replace lines 698, 699, 700 (indices 697, 698, 699) with newRSection
lines.splice(697, 3, ...newRSection);
const shift = newRSection.length - 3; // 7 - 3 = 4
console.log('Patch 3: HARD RULE section expanded (shift +' + shift + ')');

// ── Patch 4: checklist item 5 (809 + shift) ──────────────────────────────
const cl5 = 809 + shift; // 813
verify(cl5, 'CHUNK GRANULARITY & R-VALUE', 'checklist item 5 post-shift');
lines[cl5 - 1] =
  '5. CHUNK GRANULARITY & R-VALUE: R = answer_words \u2212 prefilled_words \u22648. ' +
  'answers \u22659w require \u22652-word prefilled (no-prefilled OR ["not"] on 9+w = INVALID). ' +
  'Prefer 2-word noun phrases: "the report" not "the final report". NEVER 4-word+ prefilled. ' +
  '1-2 multi-word chunks per question from: infinitives ("to know"), phrasal verbs ("find out"), ' +
  'aux+participle ("had been"). Never 9+ effective chunks.';
console.log('Patch 4: checklist item 5 updated');

// ── Write & verify ────────────────────────────────────────────────────────
fs.writeFileSync('scripts/generateBSQuestions.mjs', lines.join('\n'), 'utf8');
console.log('\nWritten. Verifying...');

const result = fs.readFileSync('scripts/generateBSQuestions.mjs', 'utf8');
[
  ['HARD RULE 1:', 'HARD RULE 1 present'],
  ['HARD RULE 2:', 'HARD RULE 2 present'],
  ['prefilled=[] on a 9+ word answer is INVALID', 'no-prefilled long sentence rule'],
  ['NEVER 4-word+', 'NEVER 4-word present'],
  ['STRONGLY PREFER 2-word noun phrases', 'STRONGLY PREFER 2-word'],
  ['"the meeting" not "the weekly meeting"', 'shorten example present'],
].forEach(function(pair) {
  console.log((result.includes(pair[0]) ? 'OK' : 'MISSING') + ': ' + pair[1]);
});
