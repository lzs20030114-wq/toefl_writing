#!/usr/bin/env node
/**
 * Detect and apply acceptedAnswerOrders to all questions in questions.json.
 *
 * Usage:
 *   node scripts/apply-alternate-orders.mjs            # preview only
 *   node scripts/apply-alternate-orders.mjs --apply     # write changes
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const { detectAlternateOrders, deriveChunkOrder } = require("../lib/questionBank/alternateOrders.js");
const sentenceEngine = require("../lib/questionBank/sentenceEngine.js");

const BANK_PATH = resolve(__dirname, "..", "data", "buildSentence", "questions.json");
const apply = process.argv.includes("--apply");

const data = JSON.parse(readFileSync(BANK_PATH, "utf8"));
const sets = data.question_sets || [];

let totalQ = 0;
let withAlts = 0;
let totalAlts = 0;
const examples = [];

for (const set of sets) {
  for (const q of set.questions) {
    totalQ++;
    const alts = detectAlternateOrders(q);
    if (alts.length === 0) {
      // Remove stale fields if present
      delete q.acceptedAnswerOrders;
      delete q.acceptedReasons;
      continue;
    }

    // Verify each alternate by building the sentence through buildWordSlots
    const verified = [];
    for (const alt of alts) {
      const { slots } = sentenceEngine.buildWordSlots(q, alt.order, { lowercase: true });
      const sentence = slots.filter(Boolean).join(" ");
      // Must differ from primary and produce a valid-length sentence
      const { answerWords } = sentenceEngine.buildWordSlots(q, [], { lowercase: true });
      const primary = answerWords.map((w) => w.toLowerCase()).join(" ");
      if (sentence !== primary && sentence.split(" ").length === primary.split(" ").length) {
        verified.push(alt);
      }
    }

    if (verified.length === 0) {
      delete q.acceptedAnswerOrders;
      delete q.acceptedReasons;
      continue;
    }

    q.acceptedAnswerOrders = verified.map((a) => a.order);
    q.acceptedReasons = verified.map((a) => a.reason);
    withAlts++;
    totalAlts += verified.length;

    if (examples.length < 8) {
      const primaryOrder = deriveChunkOrder(q);
      const { slots: altSlots } = sentenceEngine.buildWordSlots(q, verified[0].order, { lowercase: true });
      examples.push({
        id: q.id,
        primary: q.answer,
        alternate: altSlots.filter(Boolean).join(" "),
        chunk_moved: verified[0].order.find((c, i) => c !== primaryOrder[i]) || "?",
      });
    }
  }
}

console.log("==================================================");
console.log("Alternate Order Detection Report");
console.log("==================================================");
console.log(`Total questions:       ${totalQ}`);
console.log(`With alternate orders: ${withAlts}`);
console.log(`Total alternates:      ${totalAlts}`);
console.log(`Coverage:              ${Math.round((withAlts / totalQ) * 100)}%`);
console.log("--------------------------------------------------");

if (examples.length > 0) {
  console.log("\nExamples:");
  for (const ex of examples) {
    console.log(`\n  [${ex.id}]`);
    console.log(`  Primary:   ${ex.primary}`);
    console.log(`  Alternate: ${ex.alternate}`);
    console.log(`  Moved:     "${ex.chunk_moved}"`);
  }
}

if (apply) {
  writeFileSync(BANK_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`\nWritten to ${BANK_PATH}`);
} else {
  console.log("\nDry run — pass --apply to write changes.");
}
