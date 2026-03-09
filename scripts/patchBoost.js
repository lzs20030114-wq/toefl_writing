const fs = require('fs');
const content = fs.readFileSync('scripts/generateBSQuestions.mjs', 'utf8');
const lines = content.split('\n');

// 1. Find and replace buildBoostBacklog function (lines 936-1052)
const startLine = lines.findIndex(l => l.includes('function buildBoostBacklog('));
const endLine = lines.findIndex((l, i) => i > startLine && l.match(/^\}/));
console.log('buildBoostBacklog: lines', startLine+1, '-', endLine+1);

const newBacklog = `function buildBoostBacklog(poolState, pool, difficultyTargets, globalTypeTargets, styleTargets) {
  const tasks = [];
  const pushTask = (task, repeat = 1) => {
    for (let i = 0; i < repeat; i++) tasks.push({ ...task });
  };
  const totals = poolState?.typeTotals || {};
  const diffGaps = {
    easy: Math.max(0, (difficultyTargets?.easy || 0) - (pool.easy?.length || 0)),
    medium: Math.max(0, (difficultyTargets?.medium || 0) - (pool.medium?.length || 0)),
    hard: Math.max(0, (difficultyTargets?.hard || 0) - (pool.hard?.length || 0)),
  };
  const style = poolState?.style || {};

  // Priority 1 (highest): STUBBORN_TYPES — main purpose of boost
  for (const type of STUBBORN_TYPES) {
    const gap = Math.max(0, (globalTypeTargets?.[type] || 0) - (totals[type] || 0));
    if (gap <= 0) continue;
    pushTask({
      priority: 120,
      kind: 'type_gap_stubborn',
      type,
      difficulty: 'medium',
      hint: 'BOOST TARGET: generate exactly one ' + type + ' item. This is a rare type — focus entirely on getting the structure right. Do not mix with other types.',
    }, gap);
  }

  // Priority 2: style gaps (if not already satisfied)
  const embeddedGap = Math.max(0, (styleTargets?.embeddedMin || 0) - (style.embedded || 0));
  if (embeddedGap > 0) {
    pushTask({
      priority: 70,
      kind: 'style_embedded',
      type: chooseGapWeightedType(poolState, globalTypeTargets, ['1st-embedded', '3rd-reporting'], '1st-embedded'),
      difficulty: 'medium',
      hint: 'BOOST TARGET: generate exactly one embedded-question item with declarative word order inside the clause.',
    }, embeddedGap);
  }
  const negationGap = Math.max(0, (styleTargets?.negationMin || 0) - (style.negation || 0));
  if (negationGap > 0) {
    pushTask({
      priority: 68,
      kind: 'style_negation',
      type: 'negation',
      difficulty: 'medium',
      hint: 'BOOST TARGET: generate exactly one negation item.',
    }, negationGap);
  }

  // Priority 3: difficulty gaps (fallback only)
  for (const diff of ['medium', 'easy', 'hard']) {
    const gap = diffGaps[diff] || 0;
    if (gap <= 0) continue;
    const candidates = diff === 'easy' ? ['negation', '3rd-reporting'] : ['3rd-reporting', '1st-embedded'];
    pushTask({
      priority: 60,
      kind: 'difficulty_gap',
      type: chooseGapWeightedType(poolState, globalTypeTargets, candidates, '3rd-reporting'),
      difficulty: diff,
      hint: 'BOOST TARGET: generate exactly one ' + diff + ' difficulty item.',
    }, gap);
  }

  return tasks.sort((a, b) => b.priority - a.priority);
}`;

lines.splice(startLine, endLine - startLine + 1, ...newBacklog.split('\n'));
console.log('Replaced buildBoostBacklog.');

// 2. Find boost loop exit conditions and replace hasSufficientPoolCoverage with hasBoostComplete
// First, add hasBoostComplete function after hasSufficientPoolCoverage
const hsPCLine = lines.findIndex(l => l.includes('function hasSufficientPoolCoverage('));
const hsPCEnd = lines.findIndex((l, i) => i > hsPCLine && l.trim() === '}');
console.log('hasSufficientPoolCoverage ends at line:', hsPCEnd+1);

const hasBoostCompleteFn = `
  // Boost is complete when all STUBBORN_TYPE quotas are satisfied (or backlog is empty).
  function hasBoostComplete(poolState) {
    return STUBBORN_TYPES.every(type =>
      (poolState.typeTotals[type] || 0) >= (globalTypeTargets[type] || 0)
    );
  }`;

lines.splice(hsPCEnd + 1, 0, ...hasBoostCompleteFn.split('\n'));
console.log('Inserted hasBoostComplete after hasSufficientPoolCoverage.');

// 3. Replace hasSufficientPoolCoverage calls in the boost loop with hasBoostComplete
let replacedCount = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('hasSufficientPoolCoverage') && i > hsPCEnd) {
    lines[i] = lines[i].replace(/hasSufficientPoolCoverage\([^)]+\)/g, 'hasBoostComplete(computePoolState(acceptedPool))');
    replacedCount++;
    console.log('Replaced at line', i+1, ':', lines[i].trim());
  }
}
console.log('Total replacements in boost loop:', replacedCount);

fs.writeFileSync('scripts/generateBSQuestions.mjs', lines.join('\n'), 'utf8');
console.log('\nDone. Verifying...');
const verify = fs.readFileSync('scripts/generateBSQuestions.mjs', 'utf8');
console.log('buildBoostBacklog mentions STUBBORN_TYPES:', verify.includes('STUBBORN_TYPES.every') || verify.includes('type_gap_stubborn') ? 'YES' : 'NO');
console.log('hasBoostComplete defined:', verify.includes('function hasBoostComplete') ? 'YES' : 'NO');
console.log('hasSufficientPoolCoverage in boost loop:', (verify.match(/hasSufficientPoolCoverage/g)||[]).length, 'occurrences (should be 1, the definition)');
