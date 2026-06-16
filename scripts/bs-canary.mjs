#!/usr/bin/env node
/**
 * Canary self-calibration for the LLM word-audit judge — the trust anchor for UNATTENDED runs.
 *
 * Problem: an LLM judge can rubber-stamp (especially when it shares a model with the generator).
 * Solution: each batch, blind-inject a few KNOWN-BAD items. The judge must reject ALL of them.
 * If it passes any planted defect, the judge is unreliable THIS round → the loop must HALT
 * (do not trust its verdicts on the real items).
 *
 *   --make  <batch.json> <out.json> [k]   inject k canaries (default 2); writes out.json + out.manifest.json
 *   --check <verdicts.json> <manifest.json>   verify every canary was rejected; exit 1 (HALT) if not
 *
 * Canary types target the axes the DETERMINISTIC scorer CANNOT cover (so they isolate the judge):
 *   SCRAMBLE  – same word-multiset, words reordered into an ungrammatical string
 *               (passes the scorer's reconstructability check → only the LLM judge can catch it)
 *   REGISTER  – rewritten into a stiff formal third-person passive (the wrong difficulty lever)
 * Canaries get innocuous ids; the secret id→defect mapping lives only in the manifest (judge never sees it).
 */
import { readFileSync, writeFileSync } from "fs";
const WORD_RE = /[A-Za-z][A-Za-z'-]*/g;

function loadItems(json) {
  if (Array.isArray(json)) return { sets: [{ set_id: 1, questions: json }] };
  if (json.question_sets) return { sets: json.question_sets };
  if (json.questions) return { sets: [{ set_id: 1, questions: json.questions }] };
  if (json.items) return { sets: [{ set_id: 1, questions: json.items }] };
  throw new Error("unrecognized batch shape");
}
// deterministic ungrammatical scramble: sort words alphabetically (keeps multiset, breaks syntax)
function scramble(answer) {
  const ws = answer.match(WORD_RE) || [];
  const sorted = [...ws].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  // guard: if somehow unchanged, reverse instead
  let out = sorted.join(" ");
  if (out.toLowerCase() === ws.join(" ").toLowerCase()) out = [...ws].reverse().join(" ");
  return out.charAt(0).toUpperCase() + out.slice(1) + " .";
}

const mode = process.argv[2];
if (mode === "--make") {
  const inF = process.argv[3], outF = process.argv[4], k = parseInt(process.argv[5] || "2", 10);
  const { sets } = loadItems(JSON.parse(readFileSync(inF, "utf8")));
  const all = sets.flatMap(s => s.questions || []);
  if (all.length < k + 2) throw new Error(`batch too small (${all.length}) for ${k} canaries`);
  // pick k spread-out donor items with a decent length to scramble
  const donors = all.filter(q => (String(q.answer ?? q.target ?? "").match(WORD_RE) || []).length >= 7).slice(0, k);
  const manifest = { canaries: [], total_real: all.length };
  const canaryQs = donors.map((q, i) => {
    const ans = String(q.answer ?? q.target ?? "");
    const id = `bs_x${1000 + i}`; // innocuous id, looks normal
    manifest.canaries.push({ id, type: "SCRAMBLE", original: ans, planted: scramble(ans) });
    return { id, prompt: q.prompt ?? null, answer: scramble(ans), chunks: q.chunks ?? null, prefilled: q.prefilled ?? null, distractor: q.distractor ?? null };
  });
  // append canaries to the LAST set so they mix in
  const outSets = sets.map(s => ({ ...s }));
  outSets[outSets.length - 1] = { ...outSets[outSets.length - 1], questions: [...(outSets[outSets.length - 1].questions || []), ...canaryQs] };
  writeFileSync(outF, JSON.stringify({ question_sets: outSets }, null, 1));
  writeFileSync(outF.replace(/\.json$/, "") + ".manifest.json", JSON.stringify(manifest, null, 1));
  console.log(`✓ injected ${manifest.canaries.length} canaries → ${outF}`);
  console.log(`  secret manifest → ${outF.replace(/\.json$/, "")}.manifest.json (judge must NOT see this)`);
  manifest.canaries.forEach(c => console.log(`  [${c.id} ${c.type}] planted: "${c.planted}"  (from: "${c.original}")`));
} else if (mode === "--check") {
  const verdicts = JSON.parse(readFileSync(process.argv[3], "utf8"));
  const manifest = JSON.parse(readFileSync(process.argv[4], "utf8"));
  const vmap = {};
  for (const v of (Array.isArray(verdicts) ? verdicts : verdicts.verdicts || [])) vmap[v.id] = v;
  let caught = 0; const misses = [];
  for (const c of manifest.canaries) {
    const v = vmap[c.id];
    const rejected = v && /reject|fail|bad/i.test(String(v.verdict));
    if (rejected) caught++; else misses.push({ id: c.id, got: v ? v.verdict : "NO_VERDICT", planted: c.planted });
  }
  console.log(`canary check: ${caught}/${manifest.canaries.length} planted defects caught by judge`);
  if (misses.length) {
    console.log("✗ JUDGE UNRELIABLE THIS ROUND — passed planted bad items:");
    misses.forEach(m => console.log(`  [${m.id}] judge said "${m.got}"  planted: "${m.planted}"`));
    console.log("→ HALT: do not trust this batch's verdicts. Re-run judge (stricter) or stop and report.");
    process.exit(1);
  }
  console.log("✓ judge caught all canaries → its verdicts on real items are trustworthy this round.");
  console.log("  (now drop canary ids from the accepted set before saving)");
} else {
  console.log("usage: node scripts/bs-canary.mjs --make <batch> <out> [k] | --check <verdicts> <manifest>");
  process.exit(1);
}
