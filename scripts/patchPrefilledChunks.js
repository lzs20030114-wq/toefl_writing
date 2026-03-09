const fs = require('fs');
const content = fs.readFileSync('scripts/generateBSQuestions.mjs', 'utf8');
const lines = content.split('\n');

function verify(n, substr, label) {
  if (!lines[n - 1].includes(substr)) {
    console.error('VERIFY FAILED at line ' + n + ' [' + label + ']:');
    console.error('  Expected: ' + substr);
    console.error('  Actual:   ' + lines[n - 1].slice(0, 100));
    process.exit(1);
  }
  console.log('OK ' + n + ': ' + label);
}

// ── Verify ────────────────────────────────────────────────────────────────
verify(673, 'negation', 'negation prefilled rule');
verify(682, 'CHUNK GRANULARITY', 'chunk granularity header');
verify(683, 'STRONGLY PREFERRED', 'old strongly preferred line');
verify(708, 'no good prefilled anchor', 'end of chunk section (only fallback)');
verify(806, 'CHUNK GRANULARITY', 'checklist item 5');
verify(807, 'VERB DIVERSITY', 'checklist item 6');

console.log('\nAll OK. Applying...\n');

// ── Patch 1: negation prefilled rule (line 673) ───────────────────────────
lines[672] = '- negation:       a 2-word OBJECT noun phrase from the answer, e.g. "the faucet", "the email", "the report".' +
  ' Use ["not"] ONLY if the answer is \u22648 words AND no clear object noun phrase exists.';
console.log('Patch 1: negation rule updated');

// ── Patch 2: MANDATORY prefilled rate line (line 668) ────────────────────
// Also update "MANDATORY: exactly 6-7" to "TARGET: about 6-7"
verify(667, 'MANDATORY: exactly 6-7', 'mandatory prefilled line');
lines[666] = '- TARGET: about 6-7 out of 10 items should have a non-empty prefilled (~67%, matching real TOEFL).' +
  ' 3-4 items with prefilled=[] is natural \u2014 shorter sentences may not need it.';
console.log('Patch 2: prefilled rate changed to TARGET');

// ── Patch 3: Replace CHUNK GRANULARITY section (lines 682-709) ───────────
// That is indices 681-708 (0-based), 28 lines total
const newChunkSection = [
  '## CHUNK GRANULARITY \u2014 CRITICAL:',
  'Real TOEFL data: ~77% single-word chunks, ~23% multi-word. Target 6-7 effective chunks per item.',
  '',
  'MANDATORY multi-word chunks \u2014 NEVER atomize these:',
  '- Infinitives:        "to know", "to find", "to check", "to finish", "to attend", "to make"',
  '- Phrasal verbs:      "find out", "pick up", "carry out", "sign up"',
  '- Aux + participle:   "had gone", "had been", "has been", "will be", "been extended", "is scheduled"',
  '- Fixed collocations: "no idea", "what time", "on time", "in stock", "on Friday", "due to"',
  'Target: 1-2 multi-word chunks per question from the list above.',
  '',
  'NOT valid multi-word chunks (these should be prefilled instead, not left as chunks):',
  '- Bare noun phrases: "the email", "the report", "the procedure" \u2190 extract as prefilled',
  '',
  'SINGLE-WORD: subject pronouns (i/he/she/they), question words (where/when/if/whether),',
  'standalone auxiliaries (did/was/were used alone).',
  '',
  'THE KEY MATH: R = answer word count \u2212 prefilled word count.',
  '- Target R = 6-7 (yields ~6-7 effective chunks). This is the goal.',
  '- HARD RULE: answer \u22659 words \u2192 prefilled MUST be \u22652 words.',
  '  prefilled=["not"] on a 9+ word answer is INVALID \u2014 use a 2-word object noun phrase instead.',
  '- If R > 8: shorten the sentence OR add a 2-word noun-phrase prefilled to bring R \u22648.',
  '- If R \u22645: sentence too short; prefilled optional.',
  '',
  'GOOD example:',
  '  answer: "She wanted to know when the library would close." (9 words)',
  '  prefilled=["the library"] (2w) \u2192 R=7 \u2192 chunks=["she","wanted","to know","when","would","close","closes"]',
  '  Multi-word: "to know" \u2713  Distractor: "closes" (tense)',
  '',
  'BAD example (negation + long answer):',
  '  answer: "I did not receive the email about my appointment." (9 words)',
  '  BAD: prefilled=["not"] \u2192 R=8 \u2192 forces bare noun phrases as chunks (unnatural)',
  '  GOOD: prefilled=["the email"] \u2192 R=7 \u2192 chunks=["i","did","not","receive","about","my","appointment","not yet"]',
];
lines.splice(681, 27, ...newChunkSection);
const shift = newChunkSection.length - 27; // 32 - 27 = 5
console.log('Patch 3: CHUNK GRANULARITY replaced (' + newChunkSection.length + ' lines, was 28, shift=' + shift + ')');

// ── Patch 4: Checklist item 5 (line 806 + shift) ─────────────────────────
const cl5 = 806 + shift; // 810
verify(cl5, 'CHUNK GRANULARITY', 'checklist item 5 post-shift');

lines[cl5 - 1] =
  '5. CHUNK GRANULARITY & R-VALUE: Compute R = answer_words \u2212 prefilled_words for every item.' +
  ' R must be \u22648. If answer \u22659 words and prefilled=["not"]: INVALID \u2014 use a 2-word noun phrase.' +
  ' Each question should have 1-2 multi-word chunks from: infinitives ("to know", "to check"),' +
  ' phrasal verbs ("find out"), aux+participle ("had been", "will be"), fixed phrases ("no idea", "what time").' +
  ' Never atomize these. Never output 9+ effective chunks.';
console.log('Patch 4: checklist item 5 updated');

// ── Write ─────────────────────────────────────────────────────────────────
fs.writeFileSync('scripts/generateBSQuestions.mjs', lines.join('\n'), 'utf8');
console.log('\nWritten. Verifying...');

const result = fs.readFileSync('scripts/generateBSQuestions.mjs', 'utf8');
[
  ['HARD RULE: answer', 'HARD RULE present'],
  ['NOT valid multi-word chunks', 'NOT valid section present'],
  ['NEVER atomize these', 'NEVER atomize present'],
  ['R-VALUE', 'R-VALUE in checklist'],
  ['prefilled MUST be', 'prefilled MUST BE'],
  ['2-word OBJECT noun phrase', 'negation rule updated'],
  ['Target R = 6-7', 'Target R present'],
].forEach(function(pair) {
  console.log((result.includes(pair[0]) ? 'OK' : 'MISSING') + ': ' + pair[1]);
});
