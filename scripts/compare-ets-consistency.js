const fs = require("fs");
const path = require("path");
const { TPO_REFERENCE_PROFILE, isEmbeddedQuestion, isNegation } = require("../lib/questionBank/etsProfile");

const FILE = path.join(__dirname, "..", "data", "buildSentence", "questions.json");

const REF = TPO_REFERENCE_PROFILE;

function normalizeWordCount(s) {
  return String(s || "")
    .replace(/[.,!?;:]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function profileSet(set) {
  const questions = Array.isArray(set?.questions) ? set.questions : [];
  const total = questions.length || 1;
  let qmark = 0;
  let embedded = 0;
  let passive = 0;
  let distractor = 0;
  let negation = 0;
  let words = 0;
  let chunks = 0;

  questions.forEach((q) => {
    if (q?.has_question_mark) qmark += 1;
    if (q?.distractor) distractor += 1;
    const gps = Array.isArray(q?.grammar_points) ? q.grammar_points : [];
    if (isEmbeddedQuestion(gps)) embedded += 1;
    if (isNegation(gps)) negation += 1;
    const gpsText = gps.map((x) => String(x || "").toLowerCase());
    if (gpsText.some((g) => g.includes("passive"))) passive += 1;
    words += normalizeWordCount(q?.answer || "");
    const effChunks = (Array.isArray(q?.chunks) ? q.chunks : []).filter((c) => c !== q?.distractor).length;
    chunks += effChunks;
  });

  return {
    qmarkRatio: qmark / total,
    embeddedRatio: embedded / total,
    passiveRatio: passive / total,
    distractorRatio: distractor / total,
    negationRatio: negation / total,
    avgAnswerWords: words / total,
    avgEffectiveChunks: chunks / total,
  };
}

function scoreSimilarity(p) {
  const components = [
    1 - Math.abs(p.qmarkRatio - REF.qmarkRatio) / 0.2,
    1 - Math.abs(p.embeddedRatio - REF.embeddedRatio) / 0.25,
    1 - Math.abs(p.passiveRatio - REF.passiveRatio) / 0.2,
    1 - Math.abs(p.distractorRatio - REF.distractorRatio) / 0.2,
    1 - Math.abs(p.negationRatio - REF.negationRatio) / 0.2,
    1 - Math.abs(p.avgAnswerWords - REF.avgAnswerWords) / 3.5,
    1 - Math.abs(p.avgEffectiveChunks - REF.avgEffectiveChunks) / 1.5,
  ].map((x) => Math.max(0, Math.min(1, x)));

  const mean = components.reduce((a, b) => a + b, 0) / components.length;
  return Math.round(mean * 100);
}

function main() {
  const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const sets = Array.isArray(data?.question_sets) ? data.question_sets : [];
  if (sets.length === 0) {
    console.error("No sets found.");
    process.exit(1);
  }

  console.log("=== TPO Consistency Report ===");
  console.log(`Reference profile: ${JSON.stringify(REF)}`);
  let total = 0;
  sets.forEach((s) => {
    const p = profileSet(s);
    const score = scoreSimilarity(p);
    total += score;
    console.log(
      `set ${s.set_id}: score=${score} | qmark=${p.qmarkRatio.toFixed(2)} embedded=${p.embeddedRatio.toFixed(2)} passive=${p.passiveRatio.toFixed(2)} distractor=${p.distractorRatio.toFixed(2)} neg=${p.negationRatio.toFixed(2)} words=${p.avgAnswerWords.toFixed(2)} chunks=${p.avgEffectiveChunks.toFixed(2)}`,
    );
  });
  console.log(`avg score: ${(total / sets.length).toFixed(1)}`);
}

if (require.main === module) {
  main();
}
