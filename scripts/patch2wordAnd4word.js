const fs = require('fs');
const lines = fs.readFileSync('scripts/generateBSQuestions.mjs', 'utf8').split('\n');

function verify(n, substr, label) {
  if (!lines[n - 1] || !lines[n - 1].includes(substr)) {
    console.error('FAIL ' + n + ' [' + label + ']: ' + (lines[n-1]||'').slice(0, 90));
    process.exit(1);
  }
  console.log('OK ' + n + ': ' + label);
}

verify(482, 'PREFILLED (medium/easy): 3rd-person', '3rd-reporting medium prefilled note');
verify(720, 'For 3rd-person sentences', 'HARD RULE 3rd-person line');
verify(721, 'NEVER use 4-word+', 'NEVER 4-word+ line');

console.log('\nAll OK. Patching...\n');

// ── B: 3rd-person → PREFER 2-word subject NP (line 482) ──────────────────────
var line482 = lines[481];
var bi = line482.lastIndexOf('`');
lines[481] =
  'PREFILLED (medium/easy): 3rd-person answers \u2014 use the SUBJECT as prefilled. ' +
  'STRONGLY PREFER 2-word subject NP over single pronoun: ' +
  '["the manager"] > ["he"], ["the professor"] > ["she"], ["the student"], ["the librarian"], ["the visitor"]. ' +
  'Use single pronoun ["he"/"she"] ONLY if the subject NP is already long or the sentence is short (\u22648w).' +
  line482.slice(bi);
console.log('Patch B1: 3rd-reporting medium PREFILLED note updated (PREFER 2-word NP)');

// ── B: HARD RULE 3rd-person line (line 720) ───────────────────────────────────
lines[719] =
  '  For 3rd-person sentences: STRONGLY PREFER 2-word subject NP as prefilled: ' +
  '["the professor"], ["the manager"], ["the librarian"], ["the student"]. ' +
  'Use pronoun ["he"/"she"] only as fallback for short sentences (\u22648w).';
console.log('Patch B2: HARD RULE 3rd-person updated (PREFER 2-word NP)');

// ── C: NEVER 4-word+ with specific examples (line 721) ───────────────────────
lines[720] =
  '- HARD RULE: NEVER use 4-word+ prefilled. If you find yourself writing a long phrase, shorten it:' +
  '\n  "the final review meeting" \u2192 "the meeting"  |  "the next showing of the documentary" \u2192 "the documentary"' +
  '\n  "the new art gallery" \u2192 "the gallery"  |  "the new workout program" \u2192 "the program"' +
  '\n  "the registration deadline" \u2192 "the deadline"  |  "the campus coffee shop" \u2192 "the cafe"' +
  '\n  Rule: always use the CORE 2-word noun. Strip all adjectives and qualifiers.';
console.log('Patch C1: NEVER 4-word+ expanded with specific shortening examples');

// ── C: Update WARNING section to mention 4-word+ ─────────────────────────────
// Find the WARNING section
var warnIdx = -1;
for (var i = 0; i < lines.length; i++) {
  if (lines[i].includes('WARNING \u2014 PREFILLED STRATEGY HAS CHANGED')) {
    warnIdx = i;
    break;
  }
}
if (warnIdx < 0) { console.error('WARNING section not found'); process.exit(1); }
// Find the closing blank line of WARNING section
var warnEnd = warnIdx + 1;
while (warnEnd < lines.length && lines[warnEnd].trim() !== '') warnEnd++;
// Insert 4-word+ warning before the closing blank
lines.splice(warnEnd, 0,
  '  \u2022 4-word+ prefilled like "the final review meeting" or "the new workout program" \u2014 WRONG \u2718',
  '    Shorten to core 2-word: "the meeting", "the program", "the documentary", "the gallery".'
);
console.log('Patch C2: WARNING section extended with 4-word+ examples (inserted at line ' + (warnEnd + 1) + ')');

// ── Write & verify ─────────────────────────────────────────────────────────────
fs.writeFileSync('scripts/generateBSQuestions.mjs', lines.join('\n'), 'utf8');
console.log('\nWritten. Verifying...');

const r = fs.readFileSync('scripts/generateBSQuestions.mjs', 'utf8');
[
  ['STRONGLY PREFER 2-word subject NP over single pronoun', 'B1: 3rd-person prefer 2-word NP'],
  ['["the professor"] > ["she"]', 'B1: NP > pronoun example'],
  ['STRONGLY PREFER 2-word subject NP as prefilled', 'B2: HARD RULE 2-word preference'],
  ['"the final review meeting" \u2192 "the meeting"', 'C1: specific shortening example'],
  ['"the next showing of the documentary" \u2192 "the documentary"', 'C1: documentary example'],
  ['Strip all adjectives and qualifiers', 'C1: strip rule'],
  ['4-word+ prefilled like "the final review meeting"', 'C2: WARNING 4-word+'],
].forEach(function(pair) {
  console.log((r.includes(pair[0]) ? 'OK' : 'MISSING') + ': ' + pair[1]);
});
