#!/usr/bin/env node
/**
 * 首页真题卡「写作三题型题量」常量同步（契约 §8 的 counts 阶段）。
 *
 * 阅读/听力/口语的题量各自有一份几十字节的 counts.json（build_bank.mjs 落库时顺手写），
 * 首页直接 import 就行。写作没有——它的题量不是「库文件条数」，而是
 * `lib/realBank.js` 的三个访问器**跑完合流/去重/过滤之后**的数字：
 *
 *   discussion = getRealDiscussionPrompts().length   realBank/writing/discussion.json
 *                                                  + academicWriting/{recalled_supplement,
 *                                                    real_tpo_reference}.json，按 id 去重、字段不全的丢
 *   email      = getRealEmailPrompts().length        + emailWriting/tpo_reference.json，同上
 *   bs         = getRealBSQuestions().length         + buildSentence/tpo_official.json，
 *                                                    分批后**丢掉 <5 题的碎卷**（REAL_BS_MIN_BATCH）
 *   bsSets     = getRealBSBatches().length
 *
 * 所以这里不去数 data/realBank/writing/*.json 的条数（那是 272/14/7，和真实显示的
 * 281/27/132 差着合流与过滤两道工序），而是**直接跑真访问器**，把结果写回
 * components/home/realExamCounts.js 的 REAL_WRITING_COUNTS。数字之外一个字节不动。
 *
 * 为什么要 registerHooks：lib/realBank.js 是给 Next 打包用的源码，裸 Node 跑不了两件事——
 * ① `import x from "….json"` 少了 `with { type: "json" }`；② 相对 import 不带 .js 后缀。
 * 两条都只是「Node 比打包器严」，用 module hooks 在加载时补上即可，不必为脚本另建一份
 * 计数逻辑（另建一份 = 迟早和前端算出不一样的数，那正是这个常量存在要解决的问题）。
 *
 * 用法:
 *   node scripts/realbank/sync_counts.mjs            # 就地更新（幂等：没变化就不写盘）
 *   node scripts/realbank/sync_counts.mjs --dry      # 只报数字与差异
 *   node scripts/realbank/sync_counts.mjs --json     # 机器可读（Worker 用它填 result.counts_after）
 *
 * 退出码：0 正常；2 读不到文件 / 解析不出常量。
 */
import fs from "fs";
import path from "path";
import { registerHooks } from "module";
import { pathToFileURL, fileURLToPath } from "url";

const ROOT = process.cwd();
const TARGET = path.join(ROOT, "components", "home", "realExamCounts.js");

/** 让裸 Node 能 import lib/realBank.js（补 .js 后缀 + 补 JSON import 属性）。 */
function installLoaderHooks() {
  registerHooks({
    resolve(spec, ctx, next) {
      if (spec.startsWith(".") && !/\.[a-z]+$/i.test(spec)) {
        try { return next(`${spec}.js`, ctx); } catch { /* 真没有 .js 就按原样再试一次 */ }
      }
      return next(spec, ctx);
    },
    load(url, ctx, next) {
      if (url.startsWith("file:") && url.endsWith(".js") && url.includes("/lib/")) {
        const src = fs.readFileSync(fileURLToPath(url), "utf8")
          .replace(/from\s+("[^"]+\.json")\s*;/g, 'from $1 with { type: "json" };');
        return { format: "module", shortCircuit: true, source: src };
      }
      return next(url, ctx);
    },
  });
}

export async function computeWritingCounts(root = ROOT) {
  installLoaderHooks();
  const mod = await import(pathToFileURL(path.join(root, "lib", "realBank.js")).href);
  return {
    discussion: mod.getRealDiscussionPrompts().length,
    email: mod.getRealEmailPrompts().length,
    bs: mod.getRealBSQuestions().length,
    bsSets: mod.getRealBSBatches().length,
  };
}

/**
 * 只改 REAL_WRITING_COUNTS 里那四个数字，注释与文件其余部分逐字保留。
 * 正则锚在 `key:` 后面的整数上，块的范围由 `export const REAL_WRITING_COUNTS = { … };` 界定——
 * 整份重写文件会把那段解释「为什么不从 lib/realBank 现算」的注释冲掉，而那段注释正是
 * 下一个人不会重蹈覆辙（把 350KB JSON 打进首页 bundle）的唯一依据。
 */
export function rewriteCounts(source, counts) {
  const m = source.match(/(export const REAL_WRITING_COUNTS\s*=\s*\{)([\s\S]*?)(\n\};)/);
  if (!m) throw new Error("在 realExamCounts.js 里找不到 REAL_WRITING_COUNTS = { … };");
  let body = m[2];
  const changed = {};
  for (const [key, value] of Object.entries(counts)) {
    const re = new RegExp(`(\\b${key}\\s*:\\s*)(\\d+)`);
    const hit = body.match(re);
    if (!hit) throw new Error(`REAL_WRITING_COUNTS 里没有 ${key} 这一项`);
    if (Number(hit[2]) !== value) changed[key] = { from: Number(hit[2]), to: value };
    body = body.replace(re, `$1${value}`);
  }
  const block = `${m[1]}${body}${m[3]}`;
  return { text: block === m[0] ? source : source.replace(m[0], block), changed };
}

async function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry");
  const asJson = argv.includes("--json");

  if (!fs.existsSync(TARGET)) {
    console.error(`找不到 ${TARGET}`);
    process.exit(2);
  }
  const counts = await computeWritingCounts(ROOT);
  const before = fs.readFileSync(TARGET, "utf8");
  let out;
  try {
    out = rewriteCounts(before, counts);
  } catch (e) {
    console.error(String(e.message));
    process.exit(2);
  }

  const changedKeys = Object.keys(out.changed);
  if (asJson) {
    console.log(JSON.stringify({ counts, changed: out.changed, written: !dry && changedKeys.length > 0 }));
  } else {
    console.log(`■ 写作真题题量：讨论 ${counts.discussion} / 邮件 ${counts.email} / `
      + `造句 ${counts.bs} 题（${counts.bsSets} 卷）`);
    for (const [k, v] of Object.entries(out.changed)) console.log(`  ${k}: ${v.from} → ${v.to}`);
    if (!changedKeys.length) console.log("  （与常量一致，无需改动）");
  }
  if (dry || !changedKeys.length) return;
  fs.writeFileSync(TARGET, out.text, "utf8");
  if (!asJson) console.log(`  → 已更新 ${path.relative(ROOT, TARGET)}`);
}

const isMain = Boolean(process.argv[1])
  && path.basename(process.argv[1]) === "sync_counts.mjs";
if (isMain) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
