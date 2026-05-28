#!/usr/bin/env node
// Diff prefilled-type distribution between two BS staging batches.
// Usage: node scripts/ops/diff-batch-prefilled.mjs <batch1.json> <batch2.json>

import { readFileSync } from "fs";
import { classifyPrefilledType } from "../../lib/quality/scoreBatch.mjs";

const [, , p1, p2] = process.argv;
if (!p1 || !p2) {
  console.error("Usage: node scripts/ops/diff-batch-prefilled.mjs <batch1> <batch2>");
  process.exit(1);
}

function typeDistribution(file) {
  const items = JSON.parse(readFileSync(file, "utf8")).items;
  const types = {};
  const names = new Set();
  for (const it of items) {
    const pf = (it.prefilled || [])[0];
    const t = pf ? classifyPrefilledType(pf) || "unknown" : "empty";
    types[t] = (types[t] || 0) + 1;
    const m = (it.prompt || "").match(/^What did (\w+)/i) || (it.prompt || "").match(/^(?:Did|Does|Do|Was|Were|Have|Has)\s+(\w+)/i);
    if (m) names.add(m[1].toLowerCase());
  }
  return { items: items.length, types, distinctNames: names.size };
}

const a = typeDistribution(p1);
const b = typeDistribution(p2);

console.log(`Batch 1 (${p1.split(/[\\/]/).pop()}): ${a.items} items, ${a.distinctNames} distinct names`);
console.log(`Batch 2 (${p2.split(/[\\/]/).pop()}): ${b.items} items, ${b.distinctNames} distinct names`);
console.log("");
console.log("Type".padEnd(20) + "Batch1".padStart(10) + "Batch2".padStart(10));
console.log("-".repeat(40));
const keys = new Set([...Object.keys(a.types), ...Object.keys(b.types)]);
for (const k of keys) {
  const va = a.types[k] || 0;
  const vb = b.types[k] || 0;
  console.log(k.padEnd(20) + String(va).padStart(10) + String(vb).padStart(10));
}
console.log("");
console.log(`Distinct types: ${Object.keys(a.types).length} → ${Object.keys(b.types).length}`);
console.log(`Top frac:       ${(Math.max(...Object.values(a.types))/a.items*100).toFixed(0)}% → ${(Math.max(...Object.values(b.types))/b.items*100).toFixed(0)}%`);
