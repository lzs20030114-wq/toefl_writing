#!/usr/bin/env node
/**
 * listening_audio 桶清理 —— 回收已死的配音文件。
 *
 * 默认**只出清单不删**。真删要显式 --apply，而且删之前会当场重新核算引用关系，
 * 绝不信任何缓存清单——清单是几分钟前算的，中间可能刚合过库。
 *
 * 分类口径（两个作用域必须分开，混了就会误删）：
 *   literal —— 扫【全部 data/】里出现的 listening_audio/xxx 字面路径。
 *              **必须包含 staging**：那里是待合库的题，音频不能先删。
 *   liveIds —— 只认【live 题库】(data/{listening,reading,speaking}/bank) 里的题目 id。
 *              旧审计报告里的 id 只是历史记录，不代表题还活着。
 *
 *   A 在用      literal 命中                        → 留
 *   B 旧版配音   同 stem 有一个被 literal 命中的兄弟   → 删（语音升级后被 .p1.mp3 取代）
 *   C 存疑      live 库还有这个 id，但没有 url 指向它  → 留（默认保守，--include-c 才删）
 *   D 已淘汰    live 库里连 id 都没有了               → 删
 *
 * 用法:
 *   node scripts/realbank/cleanup_audio.mjs              # 只看清单
 *   node scripts/realbank/cleanup_audio.mjs --apply      # 真删 B+D
 *   node scripts/realbank/cleanup_audio.mjs --apply --keep-voice-lab   # 保留 voice-lab/ 试听样本
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const BUCKET = "listening_audio";
const OUT_DIR = path.join(ROOT, ".codex-tmp", "realbank");
const LIVE_BANK_DIRS = ["data/listening/bank", "data/reading/bank", "data/speaking/bank"];

function loadEnv() {
  for (const p of [".env.local", ".env"]) {
    try {
      fs.readFileSync(path.join(ROOT, p), "utf8").split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*(\w+)\s*=\s*(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
      });
    } catch { /* 靠进程环境变量 */ }
  }
}

function walkJson(dir, fn) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walkJson(p, fn);
    else if (f.endsWith(".json")) fn(fs.readFileSync(p, "utf8"));
  }
}

const stem = (p) => path.basename(p).replace(/\.mp3$/i, "").replace(/\.p\d+$/i, "");
const mb = (a) => a.reduce((n, f) => n + f.size, 0) / 1024 / 1024;

async function listBucket(sb) {
  const files = [];
  const walk = async (prefix) => {
    let offset = 0;
    for (;;) {
      const { data, error } = await sb.storage.from(BUCKET).list(prefix, { limit: 1000, offset });
      if (error) throw new Error(`列桶失败 (${prefix}): ${error.message}`);
      if (!data?.length) break;
      for (const f of data) {
        const p = prefix ? `${prefix}/${f.name}` : f.name;
        if (f.id === null) await walk(p);
        else files.push({ path: p, size: f.metadata?.size || 0 });
      }
      if (data.length < 1000) break;
      offset += 1000;
    }
  };
  await walk("");
  return files;
}

/** 数据库里也可能有引用（个人题库 / 练习历史 / 错题收藏）。查不到就当有，宁可少删。
 *
 * `.order("id")` 不是可有可无的：PostgREST 的 range() 分页在没有排序时行序不稳定，
 * 翻页会随机漏行——实测同一张 sessions 表两次跑分别得到 0 和 957 条引用。
 * 对删除工具来说漏行 = 少算引用 = 删掉正在用的文件，必须钉死顺序。
 */
async function dbRefs(sb) {
  const refs = new Set();
  for (const table of ["user_question_banks", "sessions", "mistake_favorites"]) {
    let from = 0;
    for (;;) {
      const { data, error } = await sb.from(table).select("*").order("id", { ascending: true }).range(from, from + 499);
      if (error) {
        console.warn(`  ⚠ ${table} 读不到（${error.message}）—— 保守起见，本次不删任何文件`);
        return null; // null = 未知，调用方必须中止
      }
      if (!data?.length) break;
      for (const r of data) {
        for (const m of JSON.stringify(r).matchAll(/listening_audio\\?\/([^"'\\\s?]+)/g)) refs.add(m[1]);
      }
      if (data.length < 500) break;
      from += 500;
    }
    console.log(`  ${table}: 累计 ${refs.size}`);
  }
  return refs;
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const includeC = args.includes("--include-c");
  const keepVoiceLab = args.includes("--keep-voice-lab");

  const { createClient } = require(path.join(ROOT, "node_modules/@supabase/supabase-js"));
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const literal = new Set(), liveIds = new Set();
  walkJson(path.join(ROOT, "data"), (t) => {
    for (const m of t.matchAll(/listening_audio\/([^"'\s?]+)/g)) literal.add(decodeURIComponent(m[1]));
  });
  for (const d of LIVE_BANK_DIRS) {
    try { walkJson(path.join(ROOT, d), (t) => { for (const m of t.matchAll(/"id"\s*:\s*"([^"]+)"/g)) liveIds.add(m[1]); }); }
    catch { console.warn(`  ⚠ 读不到 ${d}`); }
  }
  console.log(`data/ 字面引用 ${literal.size} 条（含 staging）；live 库题目 id ${liveIds.size} 个`);

  console.log("核对数据库引用…");
  const db = await dbRefs(sb);
  if (db === null) process.exit(1);
  console.log(`数据库引用 ${db.size} 条`);
  for (const r of db) literal.add(r);

  const files = await listBucket(sb);
  const A = files.filter((f) => literal.has(f.path));
  const rest = files.filter((f) => !literal.has(f.path));
  const liveStems = new Set(A.map((f) => stem(f.path)));
  const B = rest.filter((f) => liveStems.has(stem(f.path)));
  const C = rest.filter((f) => !liveStems.has(stem(f.path)) && liveIds.has(stem(f.path)));
  const D = rest.filter((f) => !liveStems.has(stem(f.path)) && !liveIds.has(stem(f.path)));

  console.log(`\n桶内 ${files.length} 个 ${mb(files).toFixed(1)} MB`);
  console.log(`A 在用          ${String(A.length).padStart(5)} 个 ${mb(A).toFixed(1).padStart(6)} MB  → 留`);
  console.log(`B 旧版配音       ${String(B.length).padStart(5)} 个 ${mb(B).toFixed(1).padStart(6)} MB  → 删`);
  console.log(`C 存疑          ${String(C.length).padStart(5)} 个 ${mb(C).toFixed(1).padStart(6)} MB  → ${includeC ? "删(--include-c)" : "留"}`);
  console.log(`D 已淘汰        ${String(D.length).padStart(5)} 个 ${mb(D).toFixed(1).padStart(6)} MB  → 删`);

  let victims = [...B, ...D, ...(includeC ? C : [])];
  if (keepVoiceLab) {
    const before = victims.length;
    victims = victims.filter((f) => !f.path.startsWith("voice-lab/"));
    console.log(`\n--keep-voice-lab: 保留 ${before - victims.length} 个试听样本`);
  }

  const manifest = path.join(OUT_DIR, `cleanup-${apply ? "applied" : "plan"}.json`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(manifest, JSON.stringify({
    bucket: BUCKET, apply, includeC, keepVoiceLab,
    totals: { files: files.length, mb: +mb(files).toFixed(1) },
    keep: { A: A.length, C: includeC ? 0 : C.length },
    deleted: victims.map((f) => ({ path: f.path, bytes: f.size })),
  }, null, 1), "utf8");
  console.log(`\n拟删 ${victims.length} 个，${mb(victims).toFixed(1)} MB`);
  console.log(`用量 ${mb(files).toFixed(1)} → ${(mb(files) - mb(victims)).toFixed(1)} MB`);
  console.log(`清单 → ${manifest}`);

  if (!apply) {
    console.log("\n（这是演练，没有删任何东西。确认无误后加 --apply）");
    return;
  }

  // 真删。分批走，每批报进度；失败的记下来但不中断——剩下的还能删掉。
  console.log("\n开始删除…");
  const failed = [];
  for (let i = 0; i < victims.length; i += 100) {
    const batch = victims.slice(i, i + 100).map((f) => f.path);
    const { error } = await sb.storage.from(BUCKET).remove(batch);
    if (error) { failed.push(...batch); console.error(`  批次 ${i / 100 + 1} 失败: ${error.message}`); }
    else process.stdout.write(`\r  已删 ${Math.min(i + 100, victims.length)}/${victims.length}   `);
  }
  process.stdout.write("\n");
  console.log(failed.length ? `完成，但 ${failed.length} 个删除失败` : "全部删除成功");
}

main().catch((e) => { console.error(e); process.exit(1); });
