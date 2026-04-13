#!/usr/bin/env node

/**
 * Validate all reading sample files under data/reading/samples/
 *
 * Usage: node scripts/validate-reading-samples.mjs
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { validateSampleFile } = require("../lib/readingBank/readingSampleSchema.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = join(__dirname, "..", "data", "reading", "samples");

// Map directory names to task types
const DIR_TO_TASK = {
  completeTheWords: "completeTheWords",
  readInDailyLife: "readInDailyLife",
  academicPassage: "academicPassage",
};

function main() {
  console.log("=== Reading Sample Validation ===\n");

  let totalFiles = 0;
  let totalItems = 0;
  let totalErrors = 0;
  let passedFiles = 0;

  for (const [dirName, taskType] of Object.entries(DIR_TO_TASK)) {
    const dirPath = join(SAMPLES_DIR, dirName);
    let files;
    try {
      files = readdirSync(dirPath).filter((f) => f.endsWith(".json"));
    } catch {
      console.log(`  [SKIP] ${dirName}/ not found\n`);
      continue;
    }

    console.log(`--- ${taskType} ---`);

    for (const file of files) {
      totalFiles++;
      const filePath = join(dirPath, file);
      let data;

      try {
        data = JSON.parse(readFileSync(filePath, "utf-8"));
      } catch (e) {
        console.log(`  ${file}: PARSE ERROR - ${e.message}`);
        totalErrors++;
        continue;
      }

      const itemCount = Array.isArray(data.items) ? data.items.length : 0;
      totalItems += itemCount;

      if (itemCount === 0) {
        console.log(`  ${file}: empty (0 items)`);
        passedFiles++;
        continue;
      }

      const result = validateSampleFile(data, taskType);

      if (result.ok) {
        console.log(`  ${file}: OK (${itemCount} items)`);
        passedFiles++;
      } else {
        console.log(`  ${file}: ${result.errors.length} errors (${itemCount} items)`);
        result.errors.forEach((e) => console.log(`    - ${e}`));
        totalErrors += result.errors.length;
      }
    }
    console.log();
  }

  console.log("=== Summary ===");
  console.log(`Files:  ${passedFiles}/${totalFiles} passed`);
  console.log(`Items:  ${totalItems} total`);
  console.log(`Errors: ${totalErrors}`);
  console.log();

  if (totalErrors > 0) {
    process.exit(1);
  }
}

main();
