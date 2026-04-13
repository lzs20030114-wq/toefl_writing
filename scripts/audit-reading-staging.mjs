#!/usr/bin/env node

/**
 * AI Answer Auditor — verifies staging items have correct answers.
 *
 * For each item in staging:
 *   1. DeepSeek independently answers each question (without seeing the marked answer)
 *   2. DeepSeek tries to answer WITHOUT the passage (guessability test)
 *   3. Results are compared and flagged
 *
 * Usage: node scripts/audit-reading-staging.mjs [--file staging-file.json] [--type rdl|ctw]
 */

import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { auditRDLItem, auditCTWItem } = require("../lib/readingGen/answerAuditor.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const STAGING_DIR = join(__dirname, "..", "data", "reading", "staging");

const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const FILE = getArg("file", "");
const TYPE = getArg("type", "");

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║       AI Answer Auditor — Staging Review        ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // Find staging files
  let files;
  if (FILE) {
    files = [FILE];
  } else {
    files = readdirSync(STAGING_DIR)
      .filter(f => f.endsWith(".json"))
      .filter(f => !TYPE || f.startsWith(TYPE));
  }

  if (files.length === 0) {
    console.log("No staging files found.");
    return;
  }

  let totalItems = 0, totalQuestions = 0, totalMismatches = 0, totalGuessable = 0, totalCritical = 0;

  for (const file of files) {
    const filePath = join(STAGING_DIR, file);
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    const items = data.items || [];
    const type = data.type || (file.startsWith("rdl") ? "readInDailyLife" : "completeTheWords");

    console.log(`━━━ ${file} (${items.length} items, type=${type}) ━━━\n`);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      totalItems++;

      let audit;
      if (type === "readInDailyLife") {
        audit = await auditRDLItem(item);
      } else {
        audit = await auditCTWItem(item);
      }

      if (audit.error) {
        console.log(`  ✗ ${item.id}: ${audit.error}`);
        continue;
      }

      const icon = audit.criticalFlags > 0 ? "🔴" : audit.mismatches > 0 ? "🟡" : "✅";
      const matchLabel = type === "readInDailyLife"
        ? `${audit.matches}/${audit.totalQuestions} match`
        : `${audit.matches}/${audit.totalBlanks} match`;

      totalQuestions += type === "readInDailyLife" ? audit.totalQuestions : audit.totalBlanks;
      totalMismatches += audit.mismatches;
      totalCritical += audit.criticalFlags;
      if (audit.guessable) totalGuessable += audit.guessable;

      console.log(`  ${icon} ${item.id} (${item.genre || item.topic || ""}): ${matchLabel}` +
        (audit.guessable ? ` | ${audit.guessable} guessable` : "") +
        (audit.criticalFlags ? ` | ${audit.criticalFlags} CRITICAL` : ""));

      // Print details for mismatches and flags
      audit.results.forEach(r => {
        if (r.flags && r.flags.length > 0) {
          r.flags.forEach(f => {
            const sev = f.severity === "critical" ? "🔴" : "🟡";
            console.log(`      ${sev} ${f.type}: ${f.detail.substring(0, 120)}`);
          });
        }
      });
    }
    console.log();
  }

  // Summary
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║                  AUDIT SUMMARY                  ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`  Items audited:     ${totalItems}`);
  console.log(`  Total questions:   ${totalQuestions}`);
  console.log(`  Mismatches:        ${totalMismatches} (${(totalMismatches/totalQuestions*100).toFixed(1)}%)`);
  console.log(`  Critical flags:    ${totalCritical}`);
  console.log(`  Guessable:         ${totalGuessable}`);
  console.log(`  Accuracy:          ${((totalQuestions - totalMismatches)/totalQuestions*100).toFixed(1)}%`);

  if (totalCritical > 0) {
    console.log("\n  ⚠️  CRITICAL issues found — review flagged items before deploying!");
  } else {
    console.log("\n  ✅ No critical issues. Items are ready for deployment.");
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
