#!/usr/bin/env node
// NON-DESTRUCTIVE tier tagging. Adds a `tier` field to every reference item that
// lacks one, inferred from the file's source/wrapper. Never deletes or edits
// question content; only inserts the tier label (idempotent — re-running is safe).
// tiers: official | recalled | legacy | third_party
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
const root = resolve(import.meta.dirname, "..", "..");
const R = p => resolve(root, p);

// file -> default tier for items that don't already carry one
const FILE_TIER = {
  "data/academicWriting/real_tpo_reference.json": "legacy",     // 81 untagged are legacy; the 4 tagged 'official' are preserved
  "data/academicWriting/recalled_supplement.json": "recalled",
  "data/emailWriting/tpo_reference.json": "legacy",             // 11 untagged legacy; 2 tagged official preserved
  "data/emailWriting/practice_supplement.json": "third_party",  // already 'uncertain' -> leave as-is (has tier)
  "data/reading/samples/readInDailyLife/ets_official.json": "official",
  "data/reading/samples/readInDailyLife/third_party.json": "third_party",
  "data/reading/samples/readInDailyLife/goarno.json": "third_party",
  "data/reading/samples/readInDailyLife/ets_fulllength.json": "official",
  "data/reading/samples/academicPassage/ets_official.json": "official",
  "data/reading/samples/academicPassage/third_party.json": "third_party",
  "data/reading/samples/academicPassage/ets_fulllength.json": "official",
  "data/reading/samples/completeTheWords/ets_official.json": "official",
  "data/reading/samples/completeTheWords/third_party.json": "third_party",
  "data/listening/samples/lc-reference.json": "third_party",
  "data/listening/samples/la-reference.json": "third_party",
  "data/listening/samples/lat-reference.json": "third_party",
  "data/listening/samples/lcr-reference.json": "third_party",
  "data/listening/samples/lc-fulllength.json": "official",
  "data/listening/samples/la-fulllength.json": "official",
  "data/listening/samples/lat-fulllength.json": "official",
  "data/speaking/samples/repeat-reference.json": "third_party",
  "data/speaking/samples/interview-reference.json": "third_party",
  "data/speaking/samples/repeat-fulllength.json": "official",
  "data/speaking/samples/interview-fulllength.json": "official",
};

const arrKey = d => Array.isArray(d) ? null : ("items" in d ? "items" : "sets" in d ? "sets" : "samples" in d ? "samples" : null);
let totalTagged = 0;
const log = [];
for (const [file, deflt] of Object.entries(FILE_TIER)) {
  let d; try { d = JSON.parse(readFileSync(R(file), "utf8")); } catch { log.push("SKIP(missing) " + file); continue; }
  const k = arrKey(d);
  const items = k ? d[k] : d;
  if (!Array.isArray(items)) { log.push("SKIP(no array) " + file); continue; }
  let tagged = 0;
  for (const it of items) {
    if (it && typeof it === "object" && !it.tier) { it.tier = deflt; tagged++; }
  }
  if (tagged) writeFileSync(R(file), JSON.stringify(k ? d : items, null, 2) + "\n");
  totalTagged += tagged;
  const counts = {};
  for (const it of items) counts[it.tier || "?"] = (counts[it.tier || "?"] || 0) + 1;
  log.push(`+${String(tagged).padStart(3)} -> ${Object.entries(counts).map(([a,b])=>a+":"+b).join(" ")}  | ${file.replace("data/","")}`);
}
log.push("\nTOTAL newly tagged: " + totalTagged);
writeFileSync(R(".research/tag-log.txt"), log.join("\n"));
console.log("done, tagged " + totalTagged);
