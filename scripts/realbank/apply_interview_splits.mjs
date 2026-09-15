#!/usr/bin/env node
/**
 * 把 data/realBank/speaking/interview-splits.json 的人工切分应用到 interview.json（原地重写）+ 同步 counts.json。
 *
 * build_bank.mjs 在 applyReview 之后调用本模块（切分表的问题 id 是按复核下架**之后**的库选的，
 * 所以必须排在最后）；也可以单独跑：
 *   node scripts/realbank/apply_interview_splits.mjs [--dry-run]
 * 幂等：拆过的 item id 带 _cN，不会再匹配切分表。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { expandInterviewSplits } from "../../lib/realExam/interviewSplits.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..", "..");
export const DEFAULT_SPEAKING_DIR = path.join(ROOT, "data", "realBank", "speaking");

/** id-aliases.json 里指向**本次产物里活着的**那条的别名条数（与 apply_review 的口径一致）。 */
function liveAliasCount(speakingDir, type, items) {
  const p = path.join(speakingDir, "id-aliases.json");
  if (!fs.existsSync(p)) return 0;
  const live = new Set((items || []).map((it) => String(it.id)));
  try {
    const rows = JSON.parse(fs.readFileSync(p, "utf8")).aliases || [];
    return rows.filter((a) => a && a.from_type === type && live.has(String(a.to))).length;
  } catch { return 0; }
}

export function applyInterviewSplitsOnDisk(speakingDir = DEFAULT_SPEAKING_DIR, { dryRun = false } = {}) {
  const bankPath = path.join(speakingDir, "interview.json");
  const manifestPath = path.join(speakingDir, "interview-splits.json");
  if (!fs.existsSync(bankPath) || !fs.existsSync(manifestPath)) return null;
  const bank = JSON.parse(fs.readFileSync(bankPath, "utf8"));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const { items, stats } = expandInterviewSplits(bank.items || [], manifest);
  if (stats.split === 0) return { changed: false, stats, count: (bank.items || []).length };
  if (!dryRun) {
    fs.writeFileSync(bankPath, JSON.stringify({ ...bank, count: items.length, items }, null, 2), "utf8");
    const countsPath = path.join(speakingDir, "counts.json");
    if (fs.existsSync(countsPath)) {
      const counts = JSON.parse(fs.readFileSync(countsPath, "utf8"));
      // 题量 = 库里套数 + **还回原卷**的跨卷重出别名（前端 withRecycled 会把保留方克隆进那一场）。
      // 本模块是 build_bank 的最后一步、整份重写 counts.json，只写 items.length 就把 apply_review
      // 刚算进去的别名项再抹掉一次（2026-09-15：面试少记 1，__tests__/realbank-item-aliases.test.js 会红）。
      counts.interview = items.length + liveAliasCount(speakingDir, "interview", items);
      fs.writeFileSync(countsPath, JSON.stringify(counts, null, 2), "utf8");
    }
  }
  return { changed: true, stats, count: items.length };
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const r = applyInterviewSplitsOnDisk(DEFAULT_SPEAKING_DIR, { dryRun });
  if (!r) { console.log("没有 interview.json 或 interview-splits.json，跳过"); return; }
  if (!r.changed) { console.log(`切分表没有命中任何 item（已经拆过？）；interview 共 ${r.count} 套`); return; }
  console.log(`${dryRun ? "[dry-run] " : ""}拆分 ${r.stats.split} 条拼盘大集 → ${r.stats.chunks} 套 4 问面试；不成套的尾巴 ${r.stats.dropped_questions} 问不入库；interview 共 ${r.count} 套`);
  for (const s of r.stats.skipped) console.warn(`  ⚠ 跳过 ${s.id} #${s.chunk}：${s.why}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
