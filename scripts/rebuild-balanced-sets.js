const fs = require("fs");
const path = require("path");
const {
  estimateQuestionDifficulty,
  ETS_2026_TARGET_COUNTS_10,
} = require("../lib/questionBank/difficultyControl");

const ROOT = path.resolve(__dirname, "..");
const BANK_PATH = path.join(ROOT, "data", "buildSentence", "questions.json");

function readBank() {
  return JSON.parse(fs.readFileSync(BANK_PATH, "utf8"));
}

function writeBank(data) {
  fs.writeFileSync(BANK_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function classify(questions) {
  const buckets = { easy: [], medium: [], hard: [] };
  questions.forEach((q) => {
    const { bucket, score } = estimateQuestionDifficulty(q);
    buckets[bucket].push({ ...q, _difficultyScore: score, _difficultyBucket: bucket });
  });
  return buckets;
}

function maxSetCount(buckets) {
  return Math.min(
    Math.floor(buckets.easy.length / ETS_2026_TARGET_COUNTS_10.easy),
    Math.floor(buckets.medium.length / ETS_2026_TARGET_COUNTS_10.medium),
    Math.floor(buckets.hard.length / ETS_2026_TARGET_COUNTS_10.hard),
  );
}

function takeN(bucket, n) {
  return bucket.splice(0, n).map((q) => {
    const out = { ...q };
    delete out._difficultyScore;
    delete out._difficultyBucket;
    return out;
  });
}

function rebuild() {
  const data = readBank();
  const allQuestions = (data.question_sets || []).flatMap((s) => (Array.isArray(s.questions) ? s.questions : []));
  const uniqueById = new Map();
  allQuestions.forEach((q) => {
    if (q?.id) uniqueById.set(q.id, q);
  });

  const buckets = classify([...uniqueById.values()]);
  const setsPossible = maxSetCount(buckets);
  if (setsPossible <= 0) {
    throw new Error(
      `insufficient pool for balanced sets: easy=${buckets.easy.length}, medium=${buckets.medium.length}, hard=${buckets.hard.length}`,
    );
  }

  buckets.easy = shuffle(buckets.easy);
  buckets.medium = shuffle(buckets.medium);
  buckets.hard = shuffle(buckets.hard);

  const question_sets = [];
  for (let i = 0; i < setsPossible; i++) {
    const picked = [
      ...takeN(buckets.easy, ETS_2026_TARGET_COUNTS_10.easy),
      ...takeN(buckets.medium, ETS_2026_TARGET_COUNTS_10.medium),
      ...takeN(buckets.hard, ETS_2026_TARGET_COUNTS_10.hard),
    ];
    const ordered = shuffle(picked);
    question_sets.push({ set_id: i + 1, questions: ordered });
  }

  writeBank({
    version: data.version || "1.1",
    question_sets,
  });

  console.log(`Rebuilt ${question_sets.length} balanced set(s).`);
  console.log(`Used counts: easy=${question_sets.length * 2}, medium=${question_sets.length * 5}, hard=${question_sets.length * 3}`);
  console.log(`Remaining pool: easy=${buckets.easy.length}, medium=${buckets.medium.length}, hard=${buckets.hard.length}`);
}

if (require.main === module) {
  try {
    rebuild();
  } catch (e) {
    console.error(`Failed to rebuild balanced sets: ${e.message}`);
    process.exit(1);
  }
}

module.exports = {
  rebuild,
};

