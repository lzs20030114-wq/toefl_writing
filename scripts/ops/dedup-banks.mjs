/**
 * dedup-banks.mjs — live 题库存量重复清理 + BS answer_hashes 重建
 *
 * 背景（已实锤）：6 个阅读/听力库存在 37–59% 的整批内容重复。同一内容在
 * 2026-06-07/08 被换新 id 反复合库（例 ap_mpveuehi_0 ≡ ap_mq45tobz_23 ≡
 * ap_mq45u24u_23，passage 与 questions 逐字相同）。根因：merge 层此前只按 id 去重，
 * 给无 id 的 staging 条目现场铸造新 id，导致同一份内容被合多次必然重复。
 *
 * 本脚本用现成指纹模块 lib/gen/contentDedup.js 的 contentKey(extractText(...)) 分组，
 * 只清 exact 内容指纹重复（不做近似/jaccard 删除），每组保留 1 条：
 *   - 保留优先级：id 中可解码出最早时间戳者（见 decodeTimestamp）；
 *   - 解不出时间戳的 id（如 ap_r1_1 / *_routine-* 种子）视为最老，优先保留；
 *   - 同龄（时间戳相同或都解不出）取数组中靠前者。
 *
 * 用法：
 *   node scripts/ops/dedup-banks.mjs                       # 默认 dry-run（只打印，不写盘）
 *   node scripts/ops/dedup-banks.mjs --apply               # 落盘 8 个库 + 写 removed-ids 报告 + 复检
 *   node scripts/ops/dedup-banks.mjs --rebuild-bs-hashes   # 只重建 BS answer_hashes.json（覆盖写）
 *   node scripts/ops/dedup-banks.mjs --apply --rebuild-bs-hashes  # 两件事一起做
 *
 * 不做 git commit（主线程统一提交）。
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { createRequire } from "module";
import { createHash } from "crypto";
import { repoRoot } from "./_shared.mjs";

const require = createRequire(import.meta.url);
const { contentKey, extractText } = require(resolve(repoRoot, "lib/gen/contentDedup.js"));

// ── 配置 ─────────────────────────────────────────────────────────────────────
// name = 库名（用于报告/预期对照）；file = 库路径；type = 传给 extractText 的题型映射。
const BANKS = [
  { name: "ctw", file: "data/reading/bank/ctw.json", type: "ctw" },
  { name: "ap", file: "data/reading/bank/ap.json", type: "ap" },
  { name: "rdl-short", file: "data/reading/bank/rdl-short.json", type: "rdl" },
  { name: "rdl-long", file: "data/reading/bank/rdl-long.json", type: "rdl" },
  { name: "lcr", file: "data/listening/bank/lcr.json", type: "lcr" },
  { name: "lc", file: "data/listening/bank/lc.json", type: "lc" },
  { name: "la", file: "data/listening/bank/la.json", type: "la" },
  { name: "lat", file: "data/listening/bank/lat.json", type: "lat" },
];

// 预期删除条数（exact 内容指纹口径，供 dry-run 核对；±个位数偏差可接受）。
const EXPECTED_REMOVE = {
  ctw: 215, ap: 151, "rdl-short": 168, "rdl-long": 78,
  lcr: 318, lc: 254, la: 160, lat: 128,
};
const DIFF_TOLERANCE = 9; // |实际 - 预期| 超过此值视为「偏差大」，dry-run 会显著告警。

const REMOVED_IDS_REPORT = "data/claudeGen/reports/dedup-removed-ids-2026-07-07.json";
const BS_QUESTIONS = "data/buildSentence/questions.json";
const BS_ANSWER_HASHES = "data/buildSentence/answer_hashes.json";

// ── id → epoch-ms 时间戳解码 ─────────────────────────────────────────────────
// 合理毫秒区间：~2001-09 (1e12) 到 ~2033-05 (2e12)。真实数据全在 2026-06 (~1.78e12)。
const EPOCH_MIN = 1e12;
const EPOCH_MAX = 2e12;
function isPlausibleEpochMs(n) {
  return Number.isFinite(n) && n >= EPOCH_MIN && n <= EPOCH_MAX;
}

/**
 * decodeTimestamp(id) → epoch-ms | null
 * 取 id 按 "_" 切分后的第二段（index 1）：
 *   纯十进制且落在合理区间 → 十进制 epoch-ms（ctw_1780332028250_543425 → 1780332028250）
 *   否则按 base36 解且落在合理区间 → epoch-ms（ap_mpveuehi_0 → parseInt("mpveuehi",36)）
 *   两者都解不出 → null（视为最老，优先保留；如 ap_r1_1、*_routine-* 种子）
 */
function decodeTimestamp(id) {
  if (typeof id !== "string") return null;
  const parts = id.split("_");
  if (parts.length < 2) return null;
  const tok = parts[1];
  if (/^\d+$/.test(tok)) {
    const dec = parseInt(tok, 10);
    if (isPlausibleEpochMs(dec)) return dec;
  }
  if (/^[0-9a-z]+$/i.test(tok)) {
    const b36 = parseInt(tok.toLowerCase(), 36);
    if (isPlausibleEpochMs(b36)) return b36;
  }
  return null;
}

// 保留排序：时间戳越小越老（越该保留）；null 视为最老 → -Infinity。
function ageValue(ts) {
  return ts == null ? -Infinity : ts;
}

// ── 单库去重 ─────────────────────────────────────────────────────────────────
/**
 * dedupBankItems(items, type) → {
 *   kept, removed, dupGroups, uniqueFingerprints, orphanAudio, groupSamples
 * }
 * 按 contentKey(extractText(type,item)) 分组；空指纹条目各自成单例（永不删）。
 * 每组保留 1 条（最老 id / 同龄靠前）。
 */
function dedupBankItems(items, type) {
  const groups = new Map(); // key -> [{ item, idx, ts }]
  const singletons = []; // 空指纹条目下标（保留）
  items.forEach((item, idx) => {
    const key = contentKey(extractText(type, item));
    if (key === "") {
      singletons.push(idx);
      return;
    }
    const ts = decodeTimestamp(item && item.id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ item, idx, ts });
  });

  const keep = new Array(items.length).fill(false);
  const groupSamples = []; // 仅重复组（size>1），供报告展示保留策略
  let dupGroups = 0;

  for (const arr of groups.values()) {
    // 选最老代表：ageValue 越小越优先；同龄取更小 idx。
    let best = arr[0];
    for (let i = 1; i < arr.length; i += 1) {
      const cand = arr[i];
      const cv = ageValue(cand.ts);
      const bv = ageValue(best.ts);
      if (cv < bv || (cv === bv && cand.idx < best.idx)) best = cand;
    }
    keep[best.idx] = true;
    if (arr.length > 1) {
      dupGroups += 1;
      groupSamples.push({
        keptId: best.item && best.item.id != null ? best.item.id : null,
        keptTs: best.ts,
        keptUndecodable: best.ts == null,
        removedIds: arr.filter((e) => e !== best).map((e) => (e.item && e.item.id != null ? e.item.id : null)),
        size: arr.length,
      });
    }
  }
  for (const idx of singletons) keep[idx] = true;

  const kept = [];
  const removed = [];
  items.forEach((item, idx) => {
    if (keep[idx]) kept.push(item);
    else removed.push(item);
  });

  const uniqueFingerprints = groups.size + singletons.length;
  const orphanAudio = removed.filter((it) => it && it.audio_url).length;
  return { kept, removed, dupGroups, uniqueFingerprints, orphanAudio, groupSamples };
}

function readBank(file) {
  const full = resolve(repoRoot, file);
  const data = JSON.parse(readFileSync(full, "utf8"));
  return { full, data };
}

// 保持顶层字段原样、2 空格缩进、文件末尾单换行（与现有库一致：JSON.stringify(...,2)+"\n"）。
function writeBank(full, data) {
  writeFileSync(full, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function fmtTs(ts) {
  if (ts == null) return "无时间戳(视为最老)";
  return `${ts} (${new Date(ts).toISOString().slice(0, 19)}Z)`;
}

// ── 库去重主流程 ─────────────────────────────────────────────────────────────
function runBankDedup({ apply }) {
  console.log(`\n=== 库存重复清理（${apply ? "APPLY 落盘" : "DRY-RUN 预览"}）===\n`);
  const removedIdsReport = {};
  const rows = [];
  let grandBefore = 0;
  let grandRemove = 0;
  let grandAfter = 0;
  let grandOrphan = 0;
  let recheckFailed = false;
  let bigDiff = false;

  for (const bank of BANKS) {
    const { full, data } = readBank(bank.file);
    const items = Array.isArray(data.items) ? data.items : [];
    const res = dedupBankItems(items, bank.type);
    const before = items.length;
    const after = res.kept.length;
    const removeN = res.removed.length;
    const exp = EXPECTED_REMOVE[bank.name];
    const diff = removeN - exp;
    if (Math.abs(diff) > DIFF_TOLERANCE) bigDiff = true;

    grandBefore += before;
    grandRemove += removeN;
    grandAfter += after;
    grandOrphan += res.orphanAudio;
    removedIdsReport[bank.name] = res.removed.map((it) => (it && it.id != null ? it.id : null));
    rows.push({ name: bank.name, before, dupGroups: res.dupGroups, removeN, after, exp, diff, orphan: res.orphanAudio, uniq: res.uniqueFingerprints });

    // 每库明细 + 两个保留样例（尽量一个「解码时间戳保留」+ 一个「无时间戳保留」）。
    const diffMark = diff === 0 ? "✓" : (Math.abs(diff) > DIFF_TOLERANCE ? "⚠ 偏差大" : "±");
    console.log(`[${bank.name}] before=${before} 去重组=${res.dupGroups} 将删=${removeN} after=${after} | 预期删=${exp} 偏差=${diff >= 0 ? "+" : ""}${diff} ${diffMark}`);
    console.log(`    唯一指纹=${res.uniqueFingerprints}（应=after=${after} → ${res.uniqueFingerprints === after ? "一致" : "不一致!"}）  被删条目含音频(孤儿)=${res.orphanAudio}`);
    const sampDecoded = res.groupSamples.find((g) => !g.keptUndecodable);
    const sampUndecoded = res.groupSamples.find((g) => g.keptUndecodable);
    for (const [label, s] of [["保留样例A", sampDecoded], ["保留样例B", sampUndecoded]]) {
      if (!s) continue;
      const shown = s.removedIds.slice(0, 3).join(", ") + (s.removedIds.length > 3 ? ` …(+${s.removedIds.length - 3})` : "");
      console.log(`    ${label}: 保留 ${s.keptId} [ts=${fmtTs(s.keptTs)}]  删 ${s.size - 1} 条: ${shown}`);
    }
    console.log("");

    if (apply) {
      data.items = res.kept; // 复用原对象 → 顶层字段与顺序完全保持
      writeBank(full, data);
      // 复检：对写回后的 kept 重新分组，应 0 重复组、0 待删。
      const recheck = dedupBankItems(res.kept, bank.type);
      if (recheck.dupGroups !== 0 || recheck.removed.length !== 0) {
        console.error(`    [复检失败] ${bank.name} 仍有 ${recheck.dupGroups} 重复组 / ${recheck.removed.length} 待删条目`);
        recheckFailed = true;
      }
    }
  }

  // 汇总表
  console.log("── 汇总 ──────────────────────────────────────────────");
  console.log("库          before  去重组   删    after  预期  偏差  孤儿音频");
  for (const r of rows) {
    console.log(
      `${r.name.padEnd(10)} ${String(r.before).padStart(6)} ${String(r.dupGroups).padStart(6)} ${String(r.removeN).padStart(5)} ${String(r.after).padStart(6)} ${String(r.exp).padStart(5)} ${String(r.diff >= 0 ? "+" + r.diff : r.diff).padStart(5)} ${String(r.orphan).padStart(7)}`
    );
  }
  console.log("──────────────────────────────────────────────────────");
  console.log(`合计 before=${grandBefore} 删=${grandRemove} after=${grandAfter} 孤儿音频=${grandOrphan}（预期删合计=${Object.values(EXPECTED_REMOVE).reduce((a, b) => a + b, 0)}）`);

  if (bigDiff) {
    console.log(`\n⚠ 存在 |偏差| > ${DIFF_TOLERANCE} 的库：请勿直接 --apply，先核对内容 / 指纹口径是否变化。`);
  }

  if (apply) {
    const rep = resolve(repoRoot, REMOVED_IDS_REPORT);
    mkdirSync(dirname(rep), { recursive: true });
    writeFileSync(rep, JSON.stringify(removedIdsReport, null, 2) + "\n", "utf8");
    console.log(`\nremoved-ids 清单已写入: ${rep}`);
    if (recheckFailed) {
      console.error("\n[错误] 至少一个库复检未通过，请人工检查。");
      process.exitCode = 1;
    } else {
      console.log("复检通过：所有库写回后 0 重复组。");
    }
  } else {
    console.log("\n(dry-run：未写任何文件。确认数字无误后加 --apply 落盘。)");
  }
}

// ── BS answer_hashes 重建 ────────────────────────────────────────────────────
// 口径复刻 scripts/generateBSQuestions.mjs：
//   stableAnswerKey(q) = normalizeText(q.answer).toLowerCase() = String(answer||"").trim().toLowerCase()
//   hashAnswer(q)      = sha256(stableAnswerKey(q)).digest("hex")
//   saveAnswerHashes   = writeFileSync(path, JSON.stringify([...set]) + "\n")   // 紧凑单行数组
function bsAnswerHash(answer) {
  const key = String(answer == null ? "" : answer).trim().toLowerCase();
  return createHash("sha256").update(key).digest("hex");
}

function rebuildBsHashes() {
  console.log(`\n=== 重建 BS answer_hashes.json ===`);
  const qFull = resolve(repoRoot, BS_QUESTIONS);
  const hFull = resolve(repoRoot, BS_ANSWER_HASHES);

  let before = 0;
  try {
    const cur = JSON.parse(readFileSync(hFull, "utf8"));
    before = Array.isArray(cur) ? new Set(cur).size : 0;
  } catch (_) {
    before = 0;
  }

  const q = JSON.parse(readFileSync(qFull, "utf8"));
  const sets = Array.isArray(q.question_sets) ? q.question_sets : [];
  const set = new Set();
  let total = 0;
  for (const s of sets) {
    const qs = s && Array.isArray(s.questions) ? s.questions : [];
    for (const qq of qs) {
      total += 1;
      set.add(bsAnswerHash(qq && qq.answer));
    }
  }

  // 覆盖写：紧凑单行，与 saveAnswerHashes 完全一致。
  writeFileSync(hFull, JSON.stringify([...set]) + "\n", "utf8");
  console.log(`遍历 question_sets=${sets.length} 题目=${total}`);
  console.log(`hash 数 before=${before} → after=${set.size}（${total - set.size} 条答案重复被折叠）`);
  console.log(`已覆盖写: ${hFull}`);
}

// ── 入口 ─────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const rebuildBs = args.includes("--rebuild-bs-hashes");

  // 库去重默认执行；唯一例外：当仅传 --rebuild-bs-hashes 时只重建 BS，不动库。
  const onlyBs = rebuildBs && args.every((a) => a === "--rebuild-bs-hashes");

  if (!onlyBs) runBankDedup({ apply });
  if (rebuildBs) rebuildBsHashes();
}

main();
