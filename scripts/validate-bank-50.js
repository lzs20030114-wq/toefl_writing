const fs = require('fs');
const path = require('path');
const { validateQuestionSet } = require('../lib/questionBank/buildSentenceSchema');
const { normalizeRuntimeQuestion, validateRuntimeQuestion, renderCorrectSentence, normalizeWord, splitWords } = require('../lib/questionBank/runtimeModel');
const { evaluateSetDifficultyAgainstTarget, formatDifficultyProfile } = require('../lib/questionBank/difficultyControl');

const file = path.join(__dirname, '..', 'data', 'buildSentence', 'questions.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const sets = Array.isArray(data.question_sets) ? data.question_sets : [];
if (sets.length === 0) {
  console.error('No question_sets found');
  process.exit(1);
}

function hasPattern(q, patterns) {
  const list = Array.isArray(q.grammar_points) ? q.grammar_points : [];
  const text = list.join(' | ').toLowerCase();
  return patterns.some((p) => text.includes(p));
}

function validateGivenPosition(rq) {
  if (!rq.given) return true;
  const full = renderCorrectSentence(rq);
  const fullWords = splitWords(full);
  const givenWords = splitWords(rq.given);
  let movableIdx = 0;
  let fullIdx = 0;
  while (movableIdx < rq.answerOrder.length && fullIdx <= fullWords.length) {
    if (movableIdx === rq.givenIndex) {
      for (let i = 0; i < givenWords.length; i++) {
        if (fullWords[fullIdx + i] !== givenWords[i]) return false;
      }
      fullIdx += givenWords.length;
    }
    const cw = splitWords(rq.answerOrder[movableIdx]);
    for (let i = 0; i < cw.length; i++) {
      if (fullWords[fullIdx + i] !== cw[i]) return false;
    }
    fullIdx += cw.length;
    movableIdx += 1;
  }
  if (rq.givenIndex === rq.answerOrder.length) {
    for (let i = 0; i < givenWords.length; i++) {
      if (fullWords[fullIdx + i] !== givenWords[i]) return false;
    }
  }
  if (rq.answer) return normalizeWord(full) === normalizeWord(rq.answer);
  return true;
}

let passFormat = 0;
let passGiven = 0;
let passEts = 0;
let passDifficulty = 0;
const failures = [];
const rounds = 50;

for (let i = 0; i < rounds; i++) {
  const set = sets[i % sets.length];
  const setId = set.set_id;
  const questions = Array.isArray(set.questions) ? set.questions : [];

  const schema = validateQuestionSet(set);
  let runtimeOk = true;
  let givenOk = true;
  const normalizedQuestions = [];

  for (const q of questions) {
    try {
      const rq = normalizeRuntimeQuestion(q);
      validateRuntimeQuestion(rq);
      normalizedQuestions.push(rq);
      if (!validateGivenPosition(rq)) givenOk = false;
    } catch (e) {
      runtimeOk = false;
      failures.push(`[round ${i+1} set ${setId}] runtime fail: ${q.id || 'unknown'} -> ${e.message}`);
    }
  }

  const formatOk = schema.ok && runtimeOk;
  if (formatOk) passFormat += 1;
  if (givenOk && runtimeOk) passGiven += 1;

  const embeddedCount = questions.filter((q) => hasPattern(q, ['embedded question', 'whether', 'how many', 'how long', 'how)'])).length;
  const qMarkCount = questions.filter((q) => q.has_question_mark === true).length;
  const distractorCount = questions.filter((q) => q.distractor != null).length;
  const passiveCount = questions.filter((q) => hasPattern(q, ['passive'])).length;
  const etsOk = embeddedCount >= 5 && qMarkCount >= 6 && distractorCount >= 2 && distractorCount <= 3 && passiveCount >= 1;
  if (etsOk) passEts += 1;
  else failures.push(`[round ${i+1} set ${setId}] ETS profile fail: embedded=${embeddedCount}, qmark=${qMarkCount}, distractor=${distractorCount}, passive=${passiveCount}`);

  const diff = evaluateSetDifficultyAgainstTarget(normalizedQuestions);
  const diffOk = diff.ok;
  if (diffOk) passDifficulty += 1;
  else failures.push(`[round ${i+1} set ${setId}] difficulty ratio drift: ${formatDifficultyProfile(diff)}`);
}

console.log('=== 50-Group Strict Validation Report ===');
console.log(`Groups: ${rounds}`);
console.log(`Format+Runtime strict: ${passFormat}/${rounds}`);
console.log(`Given position consistency: ${passGiven}/${rounds}`);
console.log(`ETS-like profile checks: ${passEts}/${rounds}`);
console.log(`Difficulty ratio similarity (heuristic): ${passDifficulty}/${rounds}`);

if (failures.length > 0) {
  console.log('\nTop failures:');
  failures.slice(0, 20).forEach((f) => console.log('- ' + f));
}

const hardFail = passFormat < rounds || passGiven < rounds || passEts < rounds;
if (hardFail) process.exit(2);
