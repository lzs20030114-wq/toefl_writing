const fs = require('fs');
const lines = fs.readFileSync('scripts/generateBSQuestions.mjs', 'utf8').split('\n');

function verify(n, substr, label) {
  if (!lines[n - 1] || !lines[n - 1].includes(substr)) {
    console.error('FAIL ' + n + ' [' + label + ']: ' + (lines[n-1]||'').slice(0, 80));
    process.exit(1);
  }
  console.log('OK ' + n + ': ' + label);
}

verify(482, 'PREFILLED (medium/easy): 3rd-person', '3rd-reporting medium PREFILLED note');
verify(694, '3rd-person subject NP: 2-word', 'WHAT TO USE 3rd-person line');
verify(722, 'For 3rd-person sentences: STRONGLY PREFER', 'HARD RULE 3rd-person');

console.log('\nAll OK. Patching...\n');

// ── Patch 1: 3rd-reporting medium PREFILLED note (line 482) ──────────────────
// Ban bare pronouns, allow 2-3 word NP equally
var line482 = lines[481];
var bi = line482.lastIndexOf('`');
lines[481] =
  'PREFILLED (medium/easy): 3rd-person answers \u2014 use a DESCRIPTIVE SUBJECT NP as prefilled. ' +
  'NEVER use bare pronouns ["he"], ["she"], ["they"] \u2014 expand to the full subject noun phrase. ' +
  '2-word NP: ["the manager"], ["the professor"], ["the student"], ["the librarian"], ["the ranger"]. ' +
  '3-word NP: ["some colleagues"], ["her study partner"], ["the front desk"], ["the shop owner"]. ' +
  'Choose 2-word or 3-word based on what sounds most natural for the subject.' +
  line482.slice(bi);
console.log('Patch 1: 3rd-reporting medium PREFILLED note updated');

// ── Patch 2: WHAT TO USE section (lines 694-695) ─────────────────────────────
// Expand 3rd-person NP to include 3-word examples, remove "2-word" restriction
verify(694, '3rd-person subject NP: 2-word', 'WHAT TO USE 3rd-person pre-patch2');
lines[693] = '- 3rd-person subject NP: 2-3 word descriptive subject noun phrase at sentence start';
lines[694] =
  '  \u2192 2-word: "the professor", "the student", "the manager", "my advisor", "the ranger"' +
  '\n  \u2192 3-word: "some colleagues", "her study partner", "the shop owner", "the front desk"' +
  '\n  \u2192 NEVER use bare pronouns "he"/"she"/"they" alone \u2014 always a descriptive NP';
console.log('Patch 2: WHAT TO USE 3rd-person updated (2-3 word, no bare pronouns)');

// ── Patch 3: HARD RULE 3rd-person line (line 722, no array shift from patch 2) ─
// Patch 2 used \n inside a string element — no array index shift
var pfLine = 722;
verify(pfLine, 'For 3rd-person sentences: STRONGLY PREFER', 'HARD RULE 3rd-person post-shift');
lines[pfLine - 1] =
  '  For 3rd-person sentences: use a DESCRIPTIVE 2-3 word subject NP.' +
  ' NEVER bare pronouns ["he"]/["she"]/["they"].' +
  ' 2-word: ["the professor"], ["the manager"], ["the student"], ["the librarian"].' +
  ' 3-word when natural: ["some colleagues"], ["her study partner"], ["the shop owner"].';
console.log('Patch 3: HARD RULE 3rd-person updated (ban bare pronouns, allow 3-word)');

// ── Patch 4: WARNING section \u2014 add bare pronoun ban ──────────────────────────
var warnLine = -1;
for (var i = 0; i < lines.length; i++) {
  if (lines[i].includes('Negation "not" belongs in CHUNKS')) { warnLine = i; break; }
}
if (warnLine < 0) { console.error('WARNING negation line not found'); process.exit(1); }
console.log('WARNING negation at line ' + (warnLine + 1));
// Insert after this line
lines.splice(warnLine + 1, 0,
  '  \u2022 Bare pronouns ["he"], ["she"], ["they"] as prefilled for 3rd-person \u2014 WRONG \u2718',
  '    Replace with descriptive NP: ["the professor"], ["the student"], ["some colleagues"].'
);
console.log('Patch 4: WARNING section extended with bare pronoun ban');

// ── Write & verify ─────────────────────────────────────────────────────────────
fs.writeFileSync('scripts/generateBSQuestions.mjs', lines.join('\n'), 'utf8');
console.log('\nWritten. Verifying...');

const r = fs.readFileSync('scripts/generateBSQuestions.mjs', 'utf8');
[
  ['NEVER use bare pronouns ["he"], ["she"], ["they"]', 'ban bare pronouns in medium hint'],
  ['3-word: ["some colleagues"]', '3-word examples in WHAT TO USE'],
  ['NEVER bare pronouns ["he"]/["she"]/["they"]', 'ban in HARD RULE'],
  ['Bare pronouns ["he"], ["she"], ["they"] as prefilled', 'ban in WARNING'],
  ['NEVER use bare pronouns ["he"]/["she"]/["they"] \u2014 always a descriptive NP', 'descriptive NP rule'],
].forEach(function(pair) {
  console.log((r.includes(pair[0]) ? 'OK' : 'MISSING') + ': ' + pair[1]);
});
