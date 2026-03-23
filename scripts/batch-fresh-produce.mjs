#!/usr/bin/env node
/**
 * Fresh batch production: generates N rounds of 6 sets each,
 * merging into the main bank after each round.
 * Each round starts with an empty pool (no seed from existing bank).
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_BANK = resolve(__dirname, "..", "data", "buildSentence", "questions.json");
const TEMP_BANK = resolve(__dirname, "..", "data", "buildSentence", "questions.fresh_tmp.json");
const RESERVE_PATH = resolve(__dirname, "..", "data", "buildSentence", "reserve_pool.json");
const HASHES_PATH = resolve(__dirname, "..", "data", "buildSentence", "answer_hashes.json");

const ROUNDS = parseInt(process.argv[2] || "5", 10);
const SETS_PER_ROUND = parseInt(process.argv[3] || "6", 10);

function loadEnv() {
  for (const p of [resolve(__dirname, "..", ".env.local"), resolve(__dirname, "..", ".env")]) {
    try {
      readFileSync(p, "utf8").split(/\r?\n/).forEach(line => {
        const m = line.match(/^\s*([\w]+)\s*=\s*(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
      });
    } catch {}
  }
}

loadEnv();

async function main() {
  console.log(`=== Fresh Batch Production: ${ROUNDS} rounds × ${SETS_PER_ROUND} sets ===\n`);

  // Backup main bank
  const mainData = JSON.parse(readFileSync(MAIN_BANK, "utf8"));
  const existingSets = mainData.question_sets || [];
  console.log(`Existing bank: ${existingSets.length} sets, ${existingSets.reduce((s, set) => s + set.questions.length, 0)} questions`);
  copyFileSync(MAIN_BANK, MAIN_BANK + ".production_backup");

  let allNewSets = [];

  for (let round = 1; round <= ROUNDS; round++) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`ROUND ${round}/${ROUNDS}`);
    console.log(`${"=".repeat(60)}`);

    // Clear pool so generation starts fresh
    writeFileSync(RESERVE_PATH, "[]");

    // Write empty bank to temp path so generator doesn't seed
    writeFileSync(TEMP_BANK, JSON.stringify({ version: "1.2", generated_at: new Date().toISOString(), question_sets: [] }, null, 2));

    const env = {
      ...process.env,
      BS_TARGET_SETS: String(SETS_PER_ROUND),
      BS_OUTPUT_PATH: TEMP_BANK,
    };

    try {
      execSync(`node "${resolve(__dirname, "generateBSQuestions.mjs")}"`, {
        env,
        stdio: "inherit",
        timeout: 40 * 60 * 1000,
        cwd: resolve(__dirname, ".."),
      });
    } catch (e) {
      console.error(`Round ${round} FAILED: ${e.message}`);
      console.error("Stopping. Previous rounds' output is saved.");
      break;
    }

    // Read generated sets
    const newData = JSON.parse(readFileSync(TEMP_BANK, "utf8"));
    const newSets = newData.question_sets || [];
    if (newSets.length === 0) {
      console.error(`Round ${round}: 0 sets generated, stopping.`);
      break;
    }

    // Renumber and merge
    const maxId = existingSets.length + allNewSets.length > 0
      ? Math.max(...[...existingSets, ...allNewSets].map(s => s.set_id))
      : 0;
    const renumbered = newSets.map((set, i) => ({
      ...set,
      set_id: maxId + i + 1,
      questions: set.questions.map((q, qi) => ({
        ...q,
        id: `ets_s${maxId + i + 1}_q${qi + 1}`,
      })),
    }));
    allNewSets.push(...renumbered);

    console.log(`\nRound ${round}: ${newSets.length} sets generated (total new: ${allNewSets.length})`);

    // Save merged bank after each round for safety
    const merged = {
      version: "1.2",
      generated_at: new Date().toISOString(),
      question_sets: [...existingSets, ...allNewSets],
    };
    writeFileSync(MAIN_BANK, JSON.stringify(merged, null, 2) + "\n");
    console.log(`Bank saved: ${merged.question_sets.length} sets total`);
  }

  // Cleanup
  try { if (existsSync(TEMP_BANK)) writeFileSync(TEMP_BANK, ""); } catch {}

  const finalData = JSON.parse(readFileSync(MAIN_BANK, "utf8"));
  const totalSets = finalData.question_sets.length;
  const totalQ = finalData.question_sets.reduce((s, set) => s + set.questions.length, 0);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`PRODUCTION COMPLETE`);
  console.log(`Total: ${totalSets} sets, ${totalQ} questions`);
  console.log(`New: ${allNewSets.length} sets added`);
  console.log(`${"=".repeat(60)}`);
}

main().catch(e => { console.error(`Fatal: ${e.message}`); process.exit(1); });
