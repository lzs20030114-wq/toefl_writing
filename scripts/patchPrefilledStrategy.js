const fs = require('fs');
const lines = fs.readFileSync('scripts/generateBSQuestions.mjs', 'utf8').split('\n');

function verify(n, substr, label) {
  if (!lines[n - 1] || !lines[n - 1].includes(substr)) {
    console.error('FAIL line ' + n + ' [' + label + ']: "' + substr + '"\n  got: ' + (lines[n-1]||'(undefined)').slice(0, 100));
    process.exit(1);
  }
  console.log('OK ' + n + ': ' + label);
}

// Verify all targets before any patching (bottom to top order)
verify(817, 'CHUNK GRANULARITY', 'checklist 5');
verify(815, 'PREFILLED COUNT', 'checklist 3');
verify(768, 'word bag check', 'end of pattern D');
verify(732, 'HOW PREFILLED', 'HOW PREFILLED header');
verify(719, 'GOOD: prefilled', 'BAD example last line');
verify(702, 'HARD RULE 1', 'HARD RULE 1');
verify(694, 'NOT valid multi-word', 'NOT valid section');
verify(670, 'WHAT TO USE', 'WHAT TO USE header');
verify(665, 'TARGET', 'TARGET rate');
verify(661, '6-7 out of every 10', 'intro rate');

console.log('\nAll verifications passed. Applying patches (bottom to top)...\n');

// ── Patch 1: Checklist item 5 (line 817) ─────────────────────────────────────
lines[816] =
  '5. CHUNK GRANULARITY & R-VALUE: R = answer_words \u2212 prefilled_words. Target R=6-7. ' +
  'Object noun phrases ("the library", "the report", "the meeting") are VALID draggable chunks \u2014 do NOT extract them as prefilled. ' +
  '1-2 multi-word chunks per question: infinitives ("to know"), phrasal verbs ("find out"), ' +
  'aux+participle ("had been", "will be"). Never 9+ effective chunks.';
console.log('Patch 1: checklist item 5 updated');

// ── Patch 2: Checklist item 3 (line 815) ─────────────────────────────────────
lines[814] =
  '3. PREFILLED COUNT: Count your non-empty prefilled items. You MUST have 8-9 items with prefilled in this batch. ' +
  'If you have fewer than 8, go back and add prefilled (subject pronoun or subject NP) to more items before outputting.';
console.log('Patch 2: checklist item 3 updated (target 8-9)');

// ── Patch 3: HOW PREFILLED WORKS patterns A-D (lines 732-768, 37 lines) ──────
verify(768, 'word bag check', 'pattern D last line pre-patch3');
verify(732, 'HOW PREFILLED', 'HOW PREFILLED header pre-patch3');

const newPatterns = [
  'HOW PREFILLED WORKS \u2014 four TPO-authentic pattern examples:',
  '',
  'Pattern A (1st-person sentence, prefilled = subject pronoun "i"):',
  '  answer:            "I asked whether the meeting had been canceled."  [8 words]',
  '  prefilled:         ["i"]',
  '  prefilled_positions: {"i": 0}',
  '  R = 8 - 1 = 7',
  '  chunks:            ["asked", "whether", "the meeting", "had been", "canceled", "cancel"]',
  '  distractor:        "cancel"  (past perfect passive vs base form)',
  '  word bag check:    asked(1)+whether(1)+the meeting(2)+had been(2)+canceled(1)=7 + i(1) = 8 \u2713',
  '',
  'Pattern B (3rd-person sentence, prefilled = 2-word subject NP "the manager"):',
  '  answer:            "The manager wanted to know if the order was ready."  [10 words]',
  '  prefilled:         ["the manager"]',
  '  prefilled_positions: {"the manager": 0}',
  '  R = 10 - 2 = 8',
  '  chunks:            ["wanted", "to know", "if", "the order", "was", "ready", "is"]',
  '  distractor:        "is"  (was vs is \u2014 tense mismatch)',
  '  word bag check:    wanted(1)+to know(2)+if(1)+the order(2)+was(1)+ready(1)=8 + the manager(2) = 10 \u2713',
  '',
  'Pattern C (interrogative, prefilled = opening frame "could you"):',
  '  answer:            "Could you tell me what time the library closes?"  [9 words]',
  '  prefilled:         ["could you"]',
  '  prefilled_positions: {"could you": 0}',
  '  R = 9 - 2 = 7',
  '  chunks:            ["tell", "me", "what time", "the library", "closes", "closed"]',
  '  distractor:        "closed"  (closes vs closed \u2014 tense)',
  '  word bag check:    tell(1)+me(1)+what time(2)+the library(2)+closes(1)=7 + could you(2) = 9 \u2713',
  '',
  'Pattern D (short sentence \u22648 words, prefilled=[]):',
  '  answer:            "I did not submit the form on time."  [8 words]',
  '  prefilled:         []',
  '  R = 8 (all words draggable)',
  '  chunks:            ["i", "did", "not", "submit", "the form", "on time", "submitted"]',
  '  distractor:        "submitted"  (did not submit vs submitted \u2014 tense)',
  '  word bag check:    i(1)+did(1)+not(1)+submit(1)+the form(2)+on time(2)=8 + []=0 \u2192 8 \u2713',
];
lines.splice(731, 37, ...newPatterns);
const shift3 = newPatterns.length - 37; // 36 - 37 = -1
console.log('Patch 3: HOW PREFILLED patterns replaced (' + newPatterns.length + ' lines, was 37, shift=' + shift3 + ')');

// ── Patch 4: HARD RULE + examples (lines 702-719, 18 lines) ──────────────────
// Line numbers unchanged since patch 3 is below line 719
verify(702, 'HARD RULE 1', 'HARD RULE 1 pre-patch4');
verify(719, 'GOOD: prefilled', 'BAD example pre-patch4');

const newHardRules = [
  '- HARD RULE: Choose the SUBJECT as prefilled (pronoun or subject NP), not the object.',
  '  For 1st-person sentences: prefilled=["i"] is almost always correct.',
  '  For 3rd-person sentences: prefilled=["the professor"] or ["her roommate"] (2-word subject NP).',
  '- HARD RULE: NEVER use 4-word+ prefilled.',
  '- If R > 8 (too many draggable words): shorten the sentence.',
  '- If R \u22645 (sentence too short): prefilled=[] is acceptable.',
  '',
  'GOOD example (1st-person):',
  '  answer: "I asked whether the library would close early." (8 words)',
  '  prefilled=["i"] \u2192 R=7 \u2192 chunks=["asked","whether","the library","would","close","early","ask"]',
  '  "the library" stays as a draggable multi-word chunk \u2714',
  '',
  'GOOD example (3rd-person, subject NP prefilled):',
  '  answer: "The professor mentioned that the deadline had been extended." (9 words)',
  '  prefilled=["the professor"] \u2192 R=7 \u2192 chunks=["mentioned","that","the deadline","had been","extended","extend"]',
  '  Multi-word: "had been" \u2714  Distractor: "extend" (form mismatch)',
];
lines.splice(701, 18, ...newHardRules);
const shift4 = newHardRules.length - 18; // 16 - 18 = -2
console.log('Patch 4: HARD RULE section replaced (' + newHardRules.length + ' lines, was 18, shift=' + shift4 + ')');

// ── Patch 5: Remove "NOT valid multi-word chunks" (lines 694-695, 2 lines) ────
// Line numbers unchanged since patches 3,4 are all below line 695
verify(694, 'NOT valid multi-word', 'NOT valid line pre-patch5');
lines.splice(693, 2);
const shift5 = -2;
console.log('Patch 5: NOT valid multi-word section removed (shift=-2)');

// ── Patch 6: WHAT TO USE AS PREFILLED (lines 670-682, 13 lines) ──────────────
// Line numbers unchanged since patches 3-5 are all below line 682
verify(670, 'WHAT TO USE', 'WHAT TO USE header pre-patch6');
verify(682, 'NEVER use 4-word', 'NEVER 4-word line pre-patch6');

const newWhatToUse = [
  'WHAT TO USE AS PREFILLED (TPO authentic \u2014 give the SUBJECT, not the object):',
  '- 1st-person pronoun:    "i" for 1st-person sentences (I wondered/asked/noticed/told...)',
  '  \u2192 prefilled=["i"], always at position 0. Simplest and most authentic.',
  '- 3rd-person subject NP: 2-word subject noun phrase at sentence start',
  '  \u2192 "the professor", "her roommate", "the student", "the manager", "my advisor"',
  '- Interrogative opener:  2-word opening frame (pronoun + aux)',
  '  \u2192 "could you", "did she", "do you"',
  '- Short sentences (\u22648 words): prefilled=[] is acceptable when no subject anchor is natural.',
  'RULE: prefilled must appear EXACTLY ONCE in the answer.',
  'RULE: Prefer 1-word pronouns ("i") \u2014 shortest, most natural, unambiguous.',
  'RULE: Object noun phrases ("the library", "the report") belong in CHUNKS, NOT prefilled.',
];
lines.splice(669, 13, ...newWhatToUse);
const shift6 = newWhatToUse.length - 13; // 11 - 13 = -2
console.log('Patch 6: WHAT TO USE replaced (' + newWhatToUse.length + ' lines, was 13, shift=' + shift6 + ')');

// ── Patch 7: TARGET rate line 665 ─────────────────────────────────────────────
// Line numbers unchanged since all patches above are below line 665
verify(665, 'TARGET', 'TARGET rate pre-patch7');
lines[664] =
  '- TARGET: about 8-9 out of 10 items should have a non-empty prefilled (~85%, matching real TOEFL). ' +
  'prefilled=[] is acceptable ONLY for short sentences (\u22648 words) with no natural subject anchor.';
console.log('Patch 7: TARGET rate updated to 8-9 (~85%)');

// ── Patch 8: Intro line 661 ───────────────────────────────────────────────────
verify(661, '6-7 out of every 10', 'intro rate pre-patch8');
lines[660] =
  'In the real TOEFL exercise, 8-9 out of every 10 questions give the student one word or short phrase ' +
  'already placed in the sentence (a "given word"). This makes the task slightly easier.';
console.log('Patch 8: intro rate updated to 8-9');

// ── Write & verify ─────────────────────────────────────────────────────────────
fs.writeFileSync('scripts/generateBSQuestions.mjs', lines.join('\n'), 'utf8');
console.log('\nWritten. Verifying...\n');

const result = fs.readFileSync('scripts/generateBSQuestions.mjs', 'utf8');
[
  ['8-9 out of every 10', 'intro rate 8-9'],
  ['8-9 out of 10 items', 'TARGET 8-9'],
  ['WHAT TO USE AS PREFILLED (TPO authentic', 'new WHAT TO USE header'],
  ['give the SUBJECT, not the object', 'subject strategy'],
  ['Object noun phrases ("the library", "the report") belong in CHUNKS', 'object NPs in chunks rule'],
  ['Pattern A (1st-person', 'Pattern A subject pronoun'],
  ['Pattern B (3rd-person', 'Pattern B subject NP'],
  ['Pattern C (interrogative', 'Pattern C opener'],
  ['Pattern D (short sentence', 'Pattern D no prefilled'],
  ['HARD RULE: Choose the SUBJECT as prefilled', 'new HARD RULE'],
  ['You MUST have 8-9 items with prefilled', 'checklist 3 updated'],
  ['Object noun phrases ("the library", "the report", "the meeting") are VALID draggable', 'checklist 5 updated'],
].forEach(function(pair) {
  console.log((result.includes(pair[0]) ? 'OK' : 'MISSING') + ': ' + pair[1]);
});
