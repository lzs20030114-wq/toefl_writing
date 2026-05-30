#!/usr/bin/env node
// Final cleanup pass over data/realExam2026/ (run AFTER all extractors):
//  1. unique ids: same-date different-卷 sets collide on date-based ids -> append
//     the 卷 letter (A/B/C) from source, else a counter.
//  2. content safety-strip: remove residual CJK + reseller-watermark substrings
//     from content string fields (metadata keys untouched).
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = resolve(ROOT, "data/realExam2026");
const META = new Set(["id", "source", "date", "tier", "type", "source_kind", "subtype", "module", "n", "words", "difficulty", "sentence_count"]);
const WM = /唯一闲鱼[^\s]*|闲鱼店铺[^\s]*|盗卖[^\s]*|及时退款[^\s]*|满分小屋|吸一口甜茶|店铺[：:][^\s]*/g;
const CJK = /[一-鿿]+/g;

function juan(source) { const m = String(source).match(/([A-Z])\s*卷/); return m ? m[1] : ""; }

function cleanStrings(v) {
  if (typeof v === "string") return v.replace(WM, " ").replace(CJK, " ").replace(/\s{2,}/g, " ").trim();
  if (Array.isArray(v)) return v.map(cleanStrings);
  if (v && typeof v === "object") { const o = {}; for (const [k, val] of Object.entries(v)) o[k] = META.has(k) ? val : cleanStrings(val); return o; }
  return v;
}

function walk(d) { let r = []; for (const f of readdirSync(d)) { const p = resolve(d, f); if (statSync(p).isDirectory()) r = r.concat(walk(p)); else if (f.endsWith(".json")) r.push(p); } return r; }

let totReid = 0, totClean = 0;
for (const f of walk(BASE)) {
  const d = JSON.parse(readFileSync(f, "utf8"));
  const items = d.items || d.sets;
  if (!Array.isArray(items)) continue;
  const seen = new Set();
  for (const it of items) {
    // 1. unique id
    if (it.id) {
      if (seen.has(it.id)) {
        let cand = it.id + (juan(it.source) ? "-" + juan(it.source) : "");
        let k = 2;
        while (seen.has(cand)) cand = `${it.id}-${k++}`;
        it.id = cand; totReid++;
      }
      seen.add(it.id);
    }
    // 2. content clean
    const before = JSON.stringify(it);
    for (const [k, val] of Object.entries(it)) if (!META.has(k)) it[k] = cleanStrings(val);
    if (JSON.stringify(it) !== before) totClean++;
  }
  writeFileSync(f, JSON.stringify(d, null, 2));
}
console.log(`qc_fix: re-ided ${totReid} colliding ids, content-cleaned ${totClean} items`);
