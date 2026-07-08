/**
 * collect-verdicts.mjs — 合并盲答判决与确定性检查，输出删除清单与报告
 *
 * 用法：
 *   node scripts/ops/review/collect-verdicts.mjs \
 *     --round1 <dir> --round2 <dir> [--round3 <dir>] --checks <file> --out <dir>
 *
 * ── 判决文件格式（约定给盲答代理用；每个 round 目录放若干 *.json）──────────────
 *   {
 *     "type": "ap",                // 与盲卷批次的 type 一致
 *     "batch": 3,
 *     "verdicts": [
 *       {
 *         "id": "ap_mq45tobz_23",
 *         "answers": { "q0": "B", "q1": "D" },   // MCQ：按盲卷 questions 下标 q0/q1/…
 *                                                //（lcr 单题只有 q0）
 *         "bs": { "assembled": "You can study there until midnight now." },  // BS 专用
 *         "multipleValid": [1],    // 可选：认为该题下标有 ≥2 个选项同样成立
 *         "note": "…"              // 可选：自由备注，不参与判分
 *       }
 *     ]
 *   }
 *   判分与批次号无关，按 (type, itemId) 匹配；同轮同 item 出现多次取最后一次。
 *
 * ── 规则 ────────────────────────────────────────────────────────────────────
 *   标答口径：直接读当前仓库各 bank（与 extract-blind-batches.mjs 的 keys sidecar 同源）。
 *   - MCQ 某题 R1 与 R2 都 ≠ 标答 → item 实锤删；
 *     恰一轮错 → item 进 needs-round3.json；提供 --round3 且 R3 对争议题也错 → 删，
 *     R3 答对 → 洗清；R3 缺该 item → 留在 needs-round3.json。
 *   - multipleValid 同一题下标在 ≥2 轮出现 → 删。
 *   - BS：assembled 归一化（小写/折叠空格/去末尾标点）后 ≠ answer，两轮成立 → 删；
 *     恰一轮 → round3（规则同 MCQ，伪题号 q0）。
 *   - checks 里任何 hardFail → 直接删（含 ctw/repeat/interview 等无盲卷题型）。
 *   - validator_threw → 不删，单独清单 validator-threw.json。
 *   - 某轮缺某 item/某题的作答 → 该轮对该题不构成「错」（缺数据不判罪）。
 *
 * ── 输出（--out 目录）───────────────────────────────────────────────────────
 *   deletion-list.json      { bank: [ids] } 实锤删除清单
 *   needs-round3.json       盲卷格式 { batches:[{type,batch,items:[…]}] }，可直接发第三轮
 *   flavor-watchlist.json   flavor 低于阈值但未删（lcr<0.45，la/lc/lat<0.40）
 *   validator-threw.json    validator 自身抛异常的条目（不删，人工看校验器）
 *   review-summary.md       中文统计报告
 * 不做 git commit。
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { resolve } from "path";
import { parseArgs } from "../_shared.mjs";
import {
  MCQ_BANKS, BATCH_SIZES,
  loadBankItems, loadBSQuestions,
  buildBlindMCQItem, buildBlindBSItem,
  extractAnswerKey,
  normLetter, normalizeAssembled,
  chunk,
} from "./_reviewShared.mjs";

const FLAVOR_THRESHOLDS = { lcr: 0.45, la: 0.4, lc: 0.4, lat: 0.4 };
const BLIND_TYPES = new Set([...MCQ_BANKS.map((b) => b.type), "bs"]);

// ── 输入读取 ─────────────────────────────────────────────────────────────────
/** 读一个 round 目录 → Map("type|itemId" → verdict)。同 key 后读覆盖先读。 */
function loadRound(dir) {
  const map = new Map();
  if (!dir) return map;
  const full = resolve(String(dir));
  const files = readdirSync(full).filter((f) => f.endsWith(".json")).sort();
  for (const f of files) {
    let data;
    try {
      data = JSON.parse(readFileSync(resolve(full, f), "utf8"));
    } catch (err) {
      console.error(`[warn] 判决文件解析失败，跳过: ${f} (${err.message})`);
      continue;
    }
    const type = data && data.type;
    const verdicts = data && Array.isArray(data.verdicts) ? data.verdicts : [];
    if (!type || !BLIND_TYPES.has(type)) {
      console.error(`[warn] 判决文件 type 无效，跳过: ${f} (type=${type})`);
      continue;
    }
    for (const v of verdicts) {
      if (!v || typeof v.id !== "string") continue;
      map.set(`${type}|${v.id}`, v);
    }
  }
  return map;
}

/** 标答 + 盲卷重建源：{ type → Map(id → { key, raw }) }（与 extract 同口径）。 */
function loadTruth() {
  const truth = new Map();
  for (const bank of MCQ_BANKS) {
    const m = new Map();
    for (const item of loadBankItems(bank.file)) {
      if (!item || typeof item.id !== "string") continue;
      m.set(item.id, { key: extractAnswerKey(bank.type, item), raw: item });
    }
    truth.set(bank.type, m);
  }
  const bs = new Map();
  for (const q of loadBSQuestions()) {
    if (!q || typeof q.id !== "string") continue;
    bs.set(q.id, { key: { answer: q.answer }, raw: q });
  }
  truth.set("bs", bs);
  return truth;
}

// ── 单题比对 ─────────────────────────────────────────────────────────────────
/**
 * verdictWrongOnQuestion(type, verdict, qKey, truthEntry) → true|false|null
 *   true  = 该轮对该题作答且 ≠ 标答
 *   false = 该轮对该题作答且 = 标答
 *   null  = 该轮缺该题作答（不判罪）
 */
function verdictWrongOnQuestion(type, verdict, qKey, truthEntry) {
  if (!verdict) return null;
  if (type === "bs") {
    const assembled = verdict.bs && verdict.bs.assembled != null ? verdict.bs.assembled : null;
    if (assembled == null) return null;
    return normalizeAssembled(assembled) !== normalizeAssembled(truthEntry.key.answer);
  }
  const a = verdict.answers && verdict.answers[qKey] != null ? verdict.answers[qKey] : null;
  if (a == null) return null;
  return normLetter(a) !== normLetter(truthEntry.key[qKey]);
}

function verdictFlagsMultipleValid(verdict, qIndex) {
  return !!(verdict && Array.isArray(verdict.multipleValid) && verdict.multipleValid.includes(qIndex));
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const r1Dir = args.get("--round1");
  const r2Dir = args.get("--round2");
  const r3Dir = args.get("--round3", null);
  const checksFile = args.get("--checks");
  const outDir = args.get("--out");
  if ([r1Dir, r2Dir, checksFile, outDir].some((v) => !v || v === true)) {
    console.error(
      "用法: node scripts/ops/review/collect-verdicts.mjs --round1 <dir> --round2 <dir> [--round3 <dir>] --checks <file> --out <dir>"
    );
    process.exitCode = 1;
    return;
  }
  const out = resolve(String(outDir));
  mkdirSync(out, { recursive: true });

  const rounds = [loadRound(r1Dir), loadRound(r2Dir)];
  if (r3Dir && r3Dir !== true) rounds.push(loadRound(r3Dir));
  const hasR3 = rounds.length === 3;
  const checks = JSON.parse(readFileSync(resolve(String(checksFile)), "utf8"));
  const truth = loadTruth();

  const deletion = {};          // bank → Set(ids)
  const deletionReasons = {};   // bank → { id → reason }
  const needsRound3 = {};       // type → [{ id, disputedQuestions:[qKey], raw }]
  const validatorThrew = {};    // bank → [{ id, error }]
  const flavorWatch = {};       // bank → [{ id, flavor }]
  const stats = {};             // bank → counters

  function bankStats(bank) {
    if (!stats[bank]) {
      stats[bank] = {
        checked: 0, blindJudged: 0,
        del_hard_fail: 0, del_wrong_both: 0, del_multiple_valid: 0, del_wrong_r3: 0,
        needs_round3: 0, cleared_by_r3: 0, validator_threw: 0, flavor_watch: 0,
      };
    }
    return stats[bank];
  }
  function markDeleted(bank, id, reason) {
    if (!deletion[bank]) {
      deletion[bank] = new Set();
      deletionReasons[bank] = {};
    }
    if (deletion[bank].has(id)) return false;
    deletion[bank].add(id);
    deletionReasons[bank][id] = reason;
    bankStats(bank)[`del_${reason}`] += 1;
    return true;
  }

  // ── 1. 确定性检查：hardFail 直接删；validator_threw 单独清单；flavor 收集 ──
  for (const [bank, perItem] of Object.entries(checks)) {
    for (const [id, rec] of Object.entries(perItem)) {
      const st = bankStats(bank);
      st.checked += 1;
      if (rec.validator_threw) {
        if (!validatorThrew[bank]) validatorThrew[bank] = [];
        validatorThrew[bank].push({ id, error: rec.validator_threw });
        st.validator_threw += 1;
        continue; // 不删、不进 flavor watch（校验器自身问题，题目状态未知）
      }
      if (Array.isArray(rec.hardFail) && rec.hardFail.length > 0) {
        markDeleted(bank, id, "hard_fail");
      }
    }
  }

  // ── 2. 盲答判决：逐 (type,id) 判 ──
  for (const type of BLIND_TYPES) {
    const truthMap = truth.get(type) || new Map();
    // 参与判定的 item = R1 ∪ R2 出现过的 id（R3 只用于复核争议，不引入新 item）。
    const judged = new Set();
    for (const roundMap of rounds.slice(0, 2)) {
      for (const key of roundMap.keys()) {
        const [t, id] = [key.slice(0, key.indexOf("|")), key.slice(key.indexOf("|") + 1)];
        if (t === type) judged.add(id);
      }
    }
    for (const id of judged) {
      const st = bankStats(type);
      st.blindJudged += 1;
      const truthEntry = truthMap.get(id);
      if (!truthEntry) {
        console.error(`[warn] 判决引用了 bank 中不存在的 id，跳过: ${type}/${id}`);
        continue;
      }
      const v1 = rounds[0].get(`${type}|${id}`) || null;
      const v2 = rounds[1].get(`${type}|${id}`) || null;
      const v3 = hasR3 ? rounds[2].get(`${type}|${id}`) || null : null;

      const qKeys = type === "bs" ? ["q0"] : Object.keys(truthEntry.key);
      let doomReason = null;
      const disputed = [];

      for (let qi = 0; qi < qKeys.length; qi += 1) {
        const qKey = type === "bs" ? "q0" : qKeys[qi];
        // multipleValid：同一题下标在 ≥2 轮被标 → 删。
        const mvCount = rounds.filter((_, ri) => {
          const vv = [v1, v2, v3][ri];
          return verdictFlagsMultipleValid(vv, qi);
        }).length;
        if (mvCount >= 2) {
          doomReason = doomReason || "multiple_valid";
          continue;
        }
        const w1 = verdictWrongOnQuestion(type, v1, qKey, truthEntry);
        const w2 = verdictWrongOnQuestion(type, v2, qKey, truthEntry);
        if (w1 === true && w2 === true) {
          doomReason = doomReason || "wrong_both";
        } else if (w1 === true || w2 === true) {
          // 恰一轮错 → 争议题；有 R3 就用 R3 定谳。
          if (hasR3) {
            const w3 = verdictWrongOnQuestion(type, v3, qKey, truthEntry);
            if (w3 === true) doomReason = doomReason || "wrong_r3";
            else if (w3 === false) st.cleared_by_r3 += 1;
            else disputed.push(qKey); // R3 缺作答 → 仍待第三轮
          } else {
            disputed.push(qKey);
          }
        }
      }

      if (doomReason) {
        const mapped = { wrong_both: "wrong_both", multiple_valid: "multiple_valid", wrong_r3: "wrong_r3" }[doomReason];
        markDeleted(type, id, mapped);
      } else if (disputed.length > 0 && !(deletion[type] && deletion[type].has(id))) {
        // hardFail 已实锤删的 item 不再进第三轮。
        if (!needsRound3[type]) needsRound3[type] = [];
        needsRound3[type].push({ id, disputedQuestions: disputed, raw: truthEntry.raw });
        st.needs_round3 += 1;
      }
    }
  }

  // ── 3. flavor watchlist：低于阈值但未删（validator_threw 除外） ──
  for (const [bank, threshold] of Object.entries(FLAVOR_THRESHOLDS)) {
    const perItem = checks[bank] || {};
    for (const [id, rec] of Object.entries(perItem)) {
      if (rec.validator_threw) continue;
      if (typeof rec.flavor !== "number" || rec.flavor >= threshold) continue;
      if (deletion[bank] && deletion[bank].has(id)) continue;
      if (!flavorWatch[bank]) flavorWatch[bank] = [];
      flavorWatch[bank].push({ id, flavor: rec.flavor });
      bankStats(bank).flavor_watch += 1;
    }
  }

  // ── 4. 落盘 ──
  const deletionOut = {};
  for (const [bank, ids] of Object.entries(deletion)) deletionOut[bank] = [...ids];
  writeJson(resolve(out, "deletion-list.json"), deletionOut);

  // needs-round3.json：盲卷格式（可直接发第三轮），按批次大小重新分批。
  const r3Batches = [];
  for (const [type, entries] of Object.entries(needsRound3)) {
    const blindItems = entries.map((e) =>
      type === "bs" ? buildBlindBSItem(e.raw) : buildBlindMCQItem(e.raw)
    );
    chunk(blindItems, BATCH_SIZES[type]).forEach((items, idx) => {
      r3Batches.push({ type, batch: idx + 1, items });
    });
  }
  writeJson(resolve(out, "needs-round3.json"), {
    generated_at: new Date().toISOString(),
    note: "恰一轮答错的争议 item（盲卷格式，含全部题目；判分时只看争议题）。",
    disputed: Object.fromEntries(
      Object.entries(needsRound3).map(([t, es]) => [t, es.map((e) => ({ id: e.id, questions: e.disputedQuestions }))])
    ),
    batches: r3Batches,
  });

  writeJson(resolve(out, "flavor-watchlist.json"), flavorWatch);
  writeJson(resolve(out, "validator-threw.json"), validatorThrew);

  // review-summary.md（中文）
  const lines = [];
  lines.push("# 盲审质检合并报告");
  lines.push("");
  lines.push(`- 生成时间: ${new Date().toISOString()}`);
  lines.push(`- 输入: round1=${r1Dir} round2=${r2Dir}${hasR3 ? ` round3=${r3Dir}` : ""}`);
  lines.push(`- 确定性检查: ${checksFile}`);
  lines.push("");
  lines.push("| 库 | 检查条目 | 盲答判定条目 | 实锤删 | 其中:硬校验 | 两轮全错 | 多valid | R3定谳 | 待R3 | R3洗清 | validator异常 | flavor观察 |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  const banksSorted = Object.keys(stats).sort();
  let totalDel = 0;
  for (const bank of banksSorted) {
    const s = stats[bank];
    const del = s.del_hard_fail + s.del_wrong_both + s.del_multiple_valid + s.del_wrong_r3;
    totalDel += del;
    lines.push(
      `| ${bank} | ${s.checked} | ${s.blindJudged} | ${del} | ${s.del_hard_fail} | ${s.del_wrong_both} | ${s.del_multiple_valid} | ${s.del_wrong_r3} | ${s.needs_round3} | ${s.cleared_by_r3} | ${s.validator_threw} | ${s.flavor_watch} |`
    );
  }
  lines.push("");
  lines.push(`合计实锤删除: ${totalDel} 条（明细见 deletion-list.json）`);
  lines.push(`待第三轮: ${Object.values(needsRound3).reduce((s, a) => s + a.length, 0)} 条（needs-round3.json，盲卷格式可直接发）`);
  lines.push(`validator 自身异常: ${Object.values(validatorThrew).reduce((s, a) => s + a.length, 0)} 条（validator-threw.json，不删，先修校验器）`);
  lines.push(`flavor 观察名单: ${Object.values(flavorWatch).reduce((s, a) => s + a.length, 0)} 条（flavor-watchlist.json，阈值 lcr<0.45 / la·lc·lat<0.40，只出清单不删）`);
  lines.push("");
  lines.push("## 规则");
  lines.push("- MCQ 某题两轮盲答均 ≠ 标答 → 实锤删；恰一轮错 → 待第三轮；第三轮仍错 → 删。");
  lines.push("- 同一题下标在 ≥2 轮被标 multipleValid → 删。");
  lines.push("- BS assembled 归一化（小写/折叠空格/去末尾标点）后比对，两轮不一致 → 删。");
  lines.push("- 确定性检查 hardFail → 直接删（含 ctw/repeat/interview 等无盲卷题型）。");
  lines.push("- validator 抛异常 → 不删、单独清单；缺作答不判罪。");
  writeFileSync(resolve(out, "review-summary.md"), lines.join("\n") + "\n", "utf8");

  // stdout 摘要
  console.log(`\n=== 合并判决完成 → ${out} ===`);
  for (const bank of banksSorted) {
    const s = stats[bank];
    const del = s.del_hard_fail + s.del_wrong_both + s.del_multiple_valid + s.del_wrong_r3;
    if (del + s.needs_round3 + s.validator_threw + s.flavor_watch === 0) continue;
    console.log(
      `[${bank}] 删=${del}（硬校验${s.del_hard_fail}/两轮错${s.del_wrong_both}/多valid${s.del_multiple_valid}/R3${s.del_wrong_r3}） 待R3=${s.needs_round3} R3洗清=${s.cleared_by_r3} validator异常=${s.validator_threw} flavor观察=${s.flavor_watch}`
    );
  }
  console.log(`合计删=${totalDel}；产物: deletion-list.json / needs-round3.json / flavor-watchlist.json / validator-threw.json / review-summary.md`);
}

main();
