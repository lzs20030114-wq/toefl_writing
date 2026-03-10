const { readFileSync, writeFileSync } = require("fs");
const { join } = require("path");

function readJson(relPath) {
  const abs = join(process.cwd(), relPath);
  const text = readFileSync(abs, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(text);
}

function writeJson(relPath, data) {
  const abs = join(process.cwd(), relPath);
  writeFileSync(abs, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

const BANK_PATH = "data/buildSentence/questions.json";

/**
 * Upload an array of question sets into the production bank.
 * Each set is renumbered (set_id) to avoid collisions, and
 * each question id is reassigned to ets_s{N}_q{M} format.
 *
 * @param {Array<{set_id: number|string, questions: Array}>} sets
 * @returns {{ addedSets: number, addedQuestions: number, newSetIds: number[] }}
 */
function uploadSetsToBank(sets) {
  if (!Array.isArray(sets) || sets.length === 0) {
    throw new Error("sets must be a non-empty array");
  }

  const bank = readJson(BANK_PATH);
  if (!bank || !Array.isArray(bank.question_sets)) {
    throw new Error("production bank is malformed");
  }

  const maxSetId = bank.question_sets.reduce((m, s) => Math.max(m, Number(s.set_id) || 0), 0);

  const newSetIds = [];
  let addedQuestions = 0;

  sets.forEach((set, i) => {
    const newSetId = maxSetId + i + 1;
    newSetIds.push(newSetId);
    const questions = (set.questions || []).map((q, qi) => ({
      ...q,
      id: `ets_s${newSetId}_q${qi + 1}`,
    }));
    bank.question_sets.push({ set_id: newSetId, questions });
    addedQuestions += questions.length;
  });

  bank.generated_at = new Date().toISOString();
  writeJson(BANK_PATH, bank);

  return { addedSets: sets.length, addedQuestions, newSetIds };
}

module.exports = { uploadSetsToBank };
