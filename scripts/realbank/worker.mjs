#!/usr/bin/env node
/**
 * 真题自动录入 —— 云端 Worker（契约 §8）。
 *
 * 一个 job = 一套真题源文件的一次录入。后台拖图建 job → GH_PAT workflow_dispatch
 * `.github/workflows/real-bank-ingest.yml` → 这个脚本在 ubuntu runner 上把整条人工链路
 * 跑一遍，最后 commit + push main，Vercel 自动部署。
 *
 * 同一份脚本本机也能跑（读 .env.local，路径一律相对 process.cwd()），这是刻意的：
 * 云端出问题时能在本机拿同一个 job id 复现，不必猜 Actions 里发生了什么。
 *
 * 阶段（写进 jobs.stage，每步 append jobs.progress）：
 *   ingest   pull_artifacts → download → detect → ingest → structure → audit
 *            → asr → merge_audio → bs_extract → build → audio → images → counts
 *            → push → push_artifacts → cleanup
 *   rebuild  pull_artifacts → build → audio → images → counts → push → push_artifacts
 *
 * 三条不许动的规矩：
 *  1. **全量重建靠 pull 下来的中间产物**。build_bank 汇总的是 .codex-tmp 里现存的
 *     *.structured.json —— 少一份就少一套卷的题。所以 pull 完要拿桶根 _manifest.json
 *     记的 structured 计数做 fail-closed 校验，少了就不 build（契约 §8）。
 *  2. **失败不 push 中间产物**。半截产物灌进桶，下一个 job pull 下来就是坏的基线。
 *     例外：ingest/structure/audit 三段成功而后段失败时把它们 push 上去（重跑省钱）。
 *  3. **付费步骤前先查余额**。2026-09-05 的事故就是账户欠费时整批照常跑完还 exit 0，
 *     40 秒把 9/1 花钱跑出来的产物用空结果盖掉了四套卷。
 *
 * 用法:
 *   node scripts/realbank/worker.mjs --job <uuid>
 *   node scripts/realbank/worker.mjs --job <uuid> --mark-failed "actions job failed"
 *   node scripts/realbank/worker.mjs --job <uuid> --skip-sync   # 本机验证：不碰产物桶
 *   node scripts/realbank/worker.mjs --job <uuid> --no-push     # 本机验证：不提交不推
 *
 * 退出码：0 正常；2 用法/入参错误；1 job 失败（已写 status=failed）。
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { createClient } from "@supabase/supabase-js";
import { pull as artifactsPull, push as artifactsPush, countStructured, scanLocal } from "./artifacts_sync.mjs";
import { detectKind, listFiles, runProbe, needsHuman } from "./detect_source.mjs";
import { decodeObjectPath } from "../../lib/realBankIngest/objectKey.mjs";

const ROOT = process.cwd();
const TMP = path.join(ROOT, ".codex-tmp");
const OUT_DIR = path.join(TMP, "realbank");
const JOBS_DIR = path.join(TMP, "realbank-jobs");
const TABLE = "real_bank_ingest_jobs";
const SOURCE_BUCKET = "real_bank_sources";
const PY = process.env.REALBANK_PY
  || (fs.existsSync("D:\\python\\python.exe") ? "D:\\python\\python" : "python");
/** 子进程用它表示「系统性失败」（没钱 / 拒绝覆盖既有产物），见 run_pipeline.mjs。 */
const EXIT_SYSTEMIC = 3;
/** 每阶段最多摘几行子进程输出进 progress —— 再多就该去看 Actions 日志了。 */
const MAX_STAGE_LINES = 40;
/** TTS 预估费用超过这个数就停下报警（与 render_real_audio.mjs 的护栏同口径）。 */
const AUDIO_COST_CEILING_CNY = 30;
// 重建后任一题型条数低于重建前的这个比例 → 视为产物残缺，拒绝推送（见 tailStages）。
const SHRINK_GUARD_RATIO = 0.8;

/* ── env / supabase ──────────────────────────────────────────────────────── */

function loadEnv() {
  for (const p of [".env.local", ".env"]) {
    try {
      fs.readFileSync(path.join(ROOT, p), "utf8").split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*(\w+)\s*=\s*(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
      });
    } catch { /* Actions 上没有 .env，靠 secrets 注入 */ }
  }
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("缺 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/* ── job 读写 ────────────────────────────────────────────────────────────── */

class Job {
  constructor(sb, row) {
    this.sb = sb;
    this.row = row;
    this.progress = Array.isArray(row.progress) ? [...row.progress] : [];
    this.stage = row.stage || null;
    this.cost = Number(row.cost_cny) || 0;
  }

  get id() { return this.row.id; }

  async patch(fields) {
    const { error } = await this.sb.from(TABLE)
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", this.id);
    // 写不进去也不能把整条链路拖死（题已经落库了，状态没写上是次要问题）——但要吼出来。
    if (error) console.error(`[worker] 更新 job 失败: ${error.message}`);
  }

  /** 每条 progress 都立刻落库：Actions 跑几十分钟，后台要能实时看到跑到哪了。 */
  async log(msg, level = "info", stage = this.stage) {
    const entry = { ts: new Date().toISOString(), stage, msg: String(msg).slice(0, 500), level };
    this.progress.push(entry);
    console.log(`[${stage || "-"}] ${level === "info" ? "" : `${level.toUpperCase()} `}${entry.msg}`);
    await this.patch({ progress: this.progress, stage });
  }

  async enter(stage) {
    this.stage = stage;
    await this.log(`—— 进入阶段 ${stage} ——`, "info", stage);
  }

  async addCost(cny, why) {
    if (!Number.isFinite(cny) || cny <= 0) return;
    this.cost += cny;
    await this.log(`花费 +¥${cny.toFixed(2)}（${why}），累计 ¥${this.cost.toFixed(2)}`);
    await this.patch({ cost_cny: Number(this.cost.toFixed(4)) });
  }
}

/* ── 子进程 ──────────────────────────────────────────────────────────────── */

function run(cmd, args, { cwd = ROOT, env = {} } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, {
      cwd,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", ...env },
      shell: false,
    });
    let out = "";
    p.stdout.on("data", (d) => { out += d; process.stdout.write(d); });
    p.stderr.on("data", (d) => { out += d; process.stderr.write(d); });
    p.on("error", (e) => resolve({ code: -1, out: `${out}\n${e.message}` }));
    p.on("close", (code) => resolve({ code, out }));
  });
}

/** 从子进程输出里摘「值得进 progress 的行」：报数行、✓/✗、错误，最多 MAX_STAGE_LINES 行。 */
function digest(out, limit = MAX_STAGE_LINES) {
  const lines = String(out || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const interesting = lines.filter((l) => /^[■→✓×✗⚠]|错误|失败|Error|Traceback|完成|合计|成品|→/.test(l));
  const picked = (interesting.length ? interesting : lines).slice(-limit);
  return picked;
}

async function stage(job, name, cmd, args, opts = {}) {
  await job.enter(name);
  await job.log(`$ ${cmd} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
  const r = await run(cmd, args, opts);
  for (const line of digest(r.out)) await job.log(line, r.code === 0 ? "info" : "warn");
  if (r.code !== 0 && !opts.allowFail) {
    throw new StageError(name, r.code === EXIT_SYSTEMIC
      ? `${name} 系统性失败（退出码 3：余额不足 / 拒绝覆盖既有产物）`
      : `${name} 失败（退出码 ${r.code}）`, r.out);
  }
  return r;
}

class StageError extends Error {
  constructor(stageName, message, out) {
    super(message);
    this.stageName = stageName;
    this.out = out;
  }
}

/* ── 付费闸：DeepSeek 余额预检 ───────────────────────────────────────────── */

/**
 * 查 DeepSeek 余额。查不到 = 不许跑（「不确定有没有钱」和「确定没钱」后果一样：
 * 跑出一批 402 空结果，还会把上次花钱跑出来的产物盖掉）。
 *
 * 本机在代理后面时 global fetch 不认 HTTPS_PROXY —— 这种场景请用 run_pipeline.mjs
 * （它自带 CONNECT 代理实现）或显式 REALBANK_SKIP_BALANCE=1。Actions 是直连，无此问题。
 */
async function checkBalance(job) {
  if (process.env.REALBANK_SKIP_BALANCE === "1") {
    await job.log("REALBANK_SKIP_BALANCE=1，跳过余额预检（只该在本机验证时用）", "warn");
    return { ok: true, total: null };
  }
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new StageError(job.stage, "环境里没有 DEEPSEEK_API_KEY，付费步骤一步都不跑");
  try {
    const r = await fetch("https://api.deepseek.com/user/balance", {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    const json = await r.json();
    const info = (json.balance_infos || [])[0] || {};
    const total = Number(info.total_balance);
    if (json.is_available !== true || !(total > 0)) {
      throw new StageError(job.stage, `DeepSeek 账户不可用（余额 ${total}），一步都不跑`);
    }
    await job.log(`DeepSeek 余额 ${total.toFixed(2)} ${info.currency || ""}`);
    return { ok: true, total };
  } catch (e) {
    if (e instanceof StageError) throw e;
    throw new StageError(job.stage, `余额接口不可达（${e.message}），按「没钱」处理，一步都不跑`);
  }
}

/* ── 源文件下载 / 清理 ───────────────────────────────────────────────────── */

async function listBucketDir(sb, bucket, prefix) {
  const out = [];
  const walk = async (dir) => {
    const { data, error } = await sb.storage.from(bucket).list(dir, { limit: 1000 });
    if (error) throw new Error(`列桶目录失败 ${dir}: ${error.message}`);
    for (const e of data || []) {
      const full = `${dir}/${e.name}`;
      // 目录项没有 id 也没有 metadata（与 lib/realBankIngest/storage.js 同一判据）。
      // 不能再用「文件名里有没有点」猜：编码后的 key 段（!<base64url>）本来就不含点。
      if (e.id == null && e.metadata == null) await walk(full);
      else out.push({ key: full, size: e.metadata?.size ?? null });
    }
  };
  await walk(prefix.replace(/\/$/, ""));
  return out;
}

async function downloadSources(job, sb, destDir) {
  const prefix = `jobs/${job.id}`;
  const objs = await listBucketDir(sb, SOURCE_BUCKET, prefix);
  if (!objs.length) throw new StageError("download", `桶里 ${prefix}/ 下一个文件都没有`);
  await job.log(`桶里 ${objs.length} 个源文件，落地到 ${path.relative(ROOT, destDir)}`);
  for (const o of objs) {
    // 桶里的 key 是编码形态（Supabase isValidKey 不收中文/空格，见 lib/realBankIngest/objectKey.mjs），
    // 落到磁盘要还原成用户当初拖进来的原始相对路径 —— 后续脚本按文件名认「阅读/听力/答案」。
    const rel = decodeObjectPath(o.key.slice(prefix.length + 1));
    // 路径穿越防御：桶里的 key 是后台写的，但这里是往本地磁盘写，不能信。
    if (!rel || rel.split("/").includes("..") || rel.includes("\\") || path.isAbsolute(rel)) {
      await job.log(`跳过可疑路径 ${rel}`, "warn");
      continue;
    }
    const { data, error } = await sb.storage.from(SOURCE_BUCKET).download(o.key);
    if (error || !data) throw new StageError("download", `下载失败 ${rel}: ${error && error.message}`);
    const abs = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from(await data.arrayBuffer()));
  }
  return objs.length;
}

async function deleteSources(job, sb) {
  const prefix = `jobs/${job.id}`;
  try {
    const objs = await listBucketDir(sb, SOURCE_BUCKET, prefix);
    if (!objs.length) return 0;
    const { error } = await sb.storage.from(SOURCE_BUCKET).remove(objs.map((o) => o.key));
    if (error) throw new Error(error.message);
    return objs.length;
  } catch (e) {
    // 删不掉只是占空间，不该把一个已经成功的 job 判成失败。
    await job.log(`源文件清理失败（不影响录入结果）：${e.message}`, "warn");
    return 0;
  }
}

/* ── git ─────────────────────────────────────────────────────────────────── */

const TRACKED_PATHS = ["data/realBank", "components/home/realExamCounts.js"];

async function commitAndPush(job, message) {
  await run("git", ["config", "user.name", "realbank-ingest[bot]"]);
  await run("git", ["config", "user.email", "realbank-ingest[bot]@users.noreply.github.com"]);
  await run("git", ["add", "--", ...TRACKED_PATHS]);
  const staged = await run("git", ["diff", "--staged", "--quiet"]);
  if (staged.code === 0) {
    await job.log("题库文件没有任何变化，不产生提交");
    return null;
  }
  const c = await run("git", ["commit", "-m", message]);
  if (c.code !== 0) throw new StageError("push", `git commit 失败：${digest(c.out, 5).join(" / ")}`);

  // generate-bs.yml 同款重试：并发的 routine 提交随时可能抢先，rebase 后重推。
  for (let i = 1; i <= 4; i += 1) {
    const f = await run("git", ["fetch", "origin", "main"]);
    const rb = f.code === 0 ? await run("git", ["rebase", "origin/main"]) : { code: 1 };
    const ps = rb.code === 0 ? await run("git", ["push", "origin", "HEAD:main"]) : { code: 1 };
    if (ps.code === 0) {
      const sha = (await run("git", ["rev-parse", "--short", "HEAD"])).out.trim().split(/\s+/).pop();
      await job.log(`push 成功（第 ${i} 次尝试），commit ${sha}`);
      return sha;
    }
    await run("git", ["rebase", "--abort"]);
    await job.log(`push 第 ${i} 次失败，10s 后重试`, "warn");
    await new Promise((r) => setTimeout(r, 10000));
  }
  throw new StageError("push", "push 连续 4 次失败");
}

/* ── 尾段（ingest 与 rebuild 共用） ─────────────────────────────────────── */

const readJson = (p, dflt = null) => {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return dflt; }
};

function bankCounts() {
  const g = (dir) => readJson(path.join(ROOT, "data", "realBank", dir, "counts.json"), {});
  const w = {};
  for (const k of ["bs", "email", "discussion"]) {
    w[k] = (readJson(path.join(ROOT, "data", "realBank", "writing", `${k}.json`), { count: 0 }) || {}).count || 0;
  }
  return { reading: g("reading"), listening: g("listening"), speaking: g("speaking"), writing: w };
}

const diffCounts = (before, after) => {
  const out = {};
  for (const sec of Object.keys(after)) {
    for (const [k, v] of Object.entries(after[sec] || {})) {
      const d = v - ((before[sec] || {})[k] || 0);
      if (d) out[k] = d;
    }
  }
  return out;
};

async function tailStages(job, { setKey, result, opts }) {
  const before = bankCounts();

  // ① build —— 全量重建。--report 落一份结构化的扣留台账，result.holds 就是从它来的。
  // 放 logs/ 下：那是产物同步白名单的排除项，否则每个 job 都会往桶里塞一份永远不删的报告。
  const reportPath = path.join(OUT_DIR, "logs", `ingest-report-${job.id}.json`);
  await stage(job, "build", "node", ["scripts/realbank/build_bank.mjs", "--report", reportPath]);
  const report = readJson(reportPath, {});
  result.audit = (setKey && report.audit && report.audit[setKey]) || null;
  result.holds = (report.holds || []).map((h) => ({
    set: h.set, section: h.section, code: h.code, detail: h.detail,
  }));
  result.disagreed = (report.disagreed || []).filter((d) => !setKey || d.set === setKey);
  const after = bankCounts();
  result.counts_after = after;
  result.added = diffCounts(before, after);
  await job.log(`落库变化：${JSON.stringify(result.added)}`);

  // 第二道防清库闸（与 pull 后的 structured 计数校验互为备份）：全量重建是「桶里有什么就产什么」，
  // 桶残缺 / 清单陈旧 / 某个解析器回归都会表现为某一题型条数骤减。录入新卷只会加题，
  // 复核下架一次也不会砍掉两成，所以任一题型缩水 >20% 一律视为事故：不提交、不推送、不回传产物。
  const shrunk = [];
  for (const sec of Object.keys(before)) {
    for (const [k, was] of Object.entries(before[sec] || {})) {
      const now = (after[sec] || {})[k] || 0;
      if (was > 0 && now < was * SHRINK_GUARD_RATIO) shrunk.push(`${sec}/${k} ${was}→${now}`);
    }
  }
  if (shrunk.length) {
    throw new Error(`重建后题量骤减，拒绝推送（疑似产物残缺）：${shrunk.join("，")}`);
  }

  // ② audio —— TTS 配音（唯一按量掏钱的一步）。先 --dry-run 看预估，超护栏就不跑。
  await job.enter("audio");
  const probe = await run("node", ["scripts/realbank/render_real_audio.mjs", "--dry-run"]);
  const est = Number((probe.out.match(/预估 ≈ ([\d.]+) 元/) || [])[1] || 0);
  await job.log(`待配音预估 ≈ ¥${est.toFixed(2)}`);
  if (est > AUDIO_COST_CEILING_CNY) {
    await job.log(`超过护栏 ¥${AUDIO_COST_CEILING_CNY}，本次不配音（题先上线，音频等人拍板后补跑 render_real_audio.mjs）`, "warn");
    result.audio = { rendered: 0, cost_cny: 0, skipped_over_ceiling: est };
  } else if (opts.noAudio) {
    await job.log("--no-audio，跳过配音", "warn");
    result.audio = { rendered: 0, cost_cny: 0, skipped: true };
  } else {
    const r = await stage(job, "audio", "node", ["scripts/realbank/render_real_audio.mjs"], { allowFail: true });
    const done = Number((r.out.match(/完成：新配 (\d+) 条/) || [])[1] || 0);
    const fail = Number((r.out.match(/失败 (\d+) 条/) || [])[1] || 0);
    result.audio = { rendered: done, failed: fail, cost_cny: Number(est.toFixed(2)) };
    await job.addCost(est, "TTS 配音");
    if (fail) await job.log(`有 ${fail} 条配音失败，可稍后重跑 render_real_audio.mjs 续配`, "warn");
  }

  // ③ images —— 材料原图裁剪 + 上传（串行，契约 §8）。裁不出图不该拖垮整个 job。
  await job.enter("images");
  const crop = await run(PY, ["scripts/realbank/crop_materials.py", "--all"]);
  for (const l of digest(crop.out, 15)) await job.log(l, crop.code === 0 ? "info" : "warn");
  const up = await run("node", ["scripts/realbank/upload_material_images.mjs"]);
  for (const l of digest(up.out, 15)) await job.log(l, up.code === 0 ? "info" : "warn");
  result.images = {
    uploaded: Number((up.out.match(/完成：上传 (\d+) 张/) || [])[1] || 0),
    crop_ok: crop.code === 0,
  };

  // ④ counts —— 写作题量常量（首页卡片显示它，不同步就永远是旧数字）
  await stage(job, "counts", "node", ["scripts/realbank/sync_counts.mjs"]);

  // ⑤ push
  await job.enter("push");
  if (opts.noPush) {
    await job.log("--no-push，跳过提交与推送", "warn");
  } else {
    const total = Object.values(result.added).reduce((a, b) => a + b, 0);
    result.commit = await commitAndPush(job,
      `data(realbank): ${job.row.kind === "rebuild" ? "rebuild" : `ingest ${job.row.set_name}`}`
      + ` ${total >= 0 ? "+" : ""}${total}题 [job ${String(job.id).slice(0, 8)}]`);
  }
}

/* ── ingest 分支（按 detected_kind 选脚本） ─────────────────────────────── */

/**
 * 第一来源（五份 PDF）与截图套壳 docx 转换之后，走的是同一条链路。
 * srcRoot 是**套目录的父目录** —— ingest_set.py / asr_cache.py / extract_bs_pages.py
 * 都按「源根目录/套名」找文件。
 */
async function runFirstPdf(job, setKey, srcRoot, result) {
  const env = { REALBANK_SRC: srcRoot, REALBANK_PY: PY };
  await job.enter("ingest");
  await checkBalance(job);
  await stage(job, "ingest", PY, ["scripts/realbank/ingest_set.py", setKey, "--json", "--src", srcRoot], { env });
  await stage(job, "structure", "node", ["scripts/realbank/structure_set.mjs", setKey], { env });
  await stage(job, "audit", "node", ["scripts/realbank/audit_answers.mjs", setKey], { env });

  // 听力/口语：整块音频转写 → 与「听力原文」序列对齐合流。
  await job.enter("asr");
  const asr = await run(PY, ["scripts/realbank/asr_cache.py", setKey, "--src", srcRoot], { env });
  for (const l of digest(asr.out, 15)) await job.log(l, asr.code === 0 ? "info" : "warn");
  await job.enter("merge_audio");
  const mg = await run(PY, ["scripts/realbank/merge_first_source_asr.py", "--set", setKey], { env });
  for (const l of digest(mg.out, 20)) await job.log(l, mg.code === 0 ? "info" : "warn");
  if (mg.code !== 0) await job.log("听力/口语合流没成功——本套只落阅读与写作", "warn");

  // 造句题在写作 PDF 里是图，只能识图抽（Qwen3-VL，按张计费但很便宜）。
  await job.enter("bs_extract");
  const bs = await run(PY, ["scripts/realbank/extract_bs_pages.py", "--only", setKey, "--src", srcRoot], { env });
  for (const l of digest(bs.out, 15)) await job.log(l, bs.code === 0 ? "info" : "warn");
  const bsCost = Number((bs.out.match(/预计费用 ¥([\d.]+)/) || [])[1] || 0);
  if (bsCost) await job.addCost(bsCost, "造句识图 Qwen3-VL");
  result.set_key = setKey;
}

/** 第二来源：文字原生 docx + 逐题 mp3。结构化不花 DeepSeek 的钱，但盲审花。 */
async function runVendorDocx(job, setDir, result) {
  await job.enter("ingest");
  const ocr = await run(PY, ["scripts/realbank/ocr_images.py", setDir]);
  for (const l of digest(ocr.out, 15)) await job.log(l, ocr.code === 0 ? "info" : "warn");

  await job.enter("structure");
  const ps = await stage(job, "structure", PY, ["scripts/realbank/parse_reformatted.py", setDir]);
  // parse_reformatted 自己派生 setkey（rf0610 / rp0704…），从它的第一行输出里取。
  const setKey = (ps.out.match(/■\s+.*?→\s+(\S+)/) || [])[1];
  if (!setKey) throw new StageError("structure", "从 parse_reformatted 输出里取不到 setkey");
  await job.log(`setkey = ${setKey}`);
  result.set_key = setKey;
  await job.patch({ set_key: setKey });

  await job.enter("audit");
  await checkBalance(job);
  await stage(job, "audit", "node", ["scripts/realbank/audit_answers.mjs", setKey]);

  await job.enter("merge_audio");
  const mg = await run(PY, ["scripts/realbank/merge_vendor_asr.py", "--set", setKey]);
  for (const l of digest(mg.out, 20)) await job.log(l, mg.code === 0 ? "info" : "warn");
  if (mg.code !== 0) await job.log("听力/口语合流没成功——本套只落阅读与写作", "warn");
}

/* ── 主流程 ─────────────────────────────────────────────────────────────── */

async function main() {
  const argv = process.argv.slice(2);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const jobId = val("--job");
  if (!jobId) {
    console.error("用法: node scripts/realbank/worker.mjs --job <uuid> [--mark-failed <msg>] [--skip-sync] [--no-push] [--no-audio]");
    process.exitCode = 2;
    return;
  }
  const opts = {
    skipSync: argv.includes("--skip-sync"),
    noPush: argv.includes("--no-push"),
    noAudio: argv.includes("--no-audio"),
    markFailed: val("--mark-failed"),
  };

  loadEnv();
  const sb = admin();
  const { data: row, error } = await sb.from(TABLE).select("*").eq("id", jobId).single();
  if (error || !row) {
    console.error(`找不到 job ${jobId}: ${error && error.message}`);
    // 用 exitCode 而不是 process.exit()：supabase-js 还挂着 fetch 的句柄，
    // 硬退在 Windows 上会撞 libuv 的 UV_HANDLE_CLOSING 断言，把真正的错误刷掉。
    process.exitCode = 2;
    return;
  }
  const job = new Job(sb, row);

  // `if: failure()` 的兜底：Worker 自己没来得及写 failed 时（runner 被 kill / OOM）补写。
  if (opts.markFailed) {
    if (["done", "failed", "cancelled"].includes(row.status)) {
      console.log(`job 已是 ${row.status}，不覆盖`);
      return;
    }
    await job.log(opts.markFailed, "error", job.stage);
    await job.patch({ status: "failed", error: opts.markFailed });
    return;
  }

  if (["done", "cancelled"].includes(row.status)) {
    console.log(`job 状态是 ${row.status}，不重复跑`);
    return;
  }

  const result = { set_key: row.set_key || row.set_name, detected_kind: row.detected_kind || null };
  let artifactsPulled = false;
  let midStagesOk = false;

  try {
    await job.patch({ status: "running", gh_run_id: process.env.GITHUB_RUN_ID || null, error: null });
    await job.log(`Worker 起跑：kind=${row.kind} set=${row.set_name}`, "info", "pull_artifacts");

    // ── pull_artifacts ──
    await job.enter("pull_artifacts");
    if (opts.skipSync) {
      await job.log("--skip-sync，用本机现有 .codex-tmp 产物", "warn");
    } else {
      const res = await artifactsPull(sb, { log: (m) => console.log(m) });
      artifactsPulled = true;
      const local = countStructured(scanLocal());
      await job.log(`产物同步完成：下载 ${res.downloaded} 个；本地 structured ${local} 套（远端清单记 ${res.structured}）`);
      // fail-closed：全量重建的正确性完全押在这批产物上，少了就不 build。
      if (!res.empty && local < res.structured) {
        throw new StageError("pull_artifacts",
          `拉下来的 structured 只有 ${local} 套，少于清单记的 ${res.structured} 套 —— 拒绝在残缺产物上做全量重建`);
      }
    }

    if (row.kind === "rebuild") {
      await tailStages(job, { setKey: null, result, opts });
    } else {
      // ── download ──
      await job.enter("download");
      const setDir = path.join(JOBS_DIR, String(job.id), row.set_name);
      fs.mkdirSync(setDir, { recursive: true });
      const n = await downloadSources(job, sb, setDir);
      await job.log(`下载 ${n} 个源文件`);

      // ── detect ──
      await job.enter("detect");
      let kind = row.source_kind && row.source_kind !== "auto" ? row.source_kind : null;
      if (kind) {
        await job.log(`人工指定格式 ${kind}，跳过探测`);
      } else {
        const det = detectKind(listFiles(setDir), runProbe(setDir, PY));
        await job.log(`探测：${det.kind}（置信度 ${det.confidence}）—— ${det.reason}`);
        if (needsHuman(det)) {
          await job.patch({
            status: "needs_format", detected_kind: det.kind,
            error: `源格式判不准：${det.reason}`,
          });
          await job.log("停在 needs_format，等后台人工选格式", "warn");
          return;
        }
        kind = det.kind;
      }
      result.detected_kind = kind;
      await job.patch({ detected_kind: kind });

      // ── ingest 分支 ──
      if (kind === "vendor_docx") {
        await runVendorDocx(job, setDir, result);
      } else if (kind === "screenshot_docx") {
        // 截图套壳先转成旧管线认识的 PDF 布局，再照第一来源那条线走。
        await job.enter("ingest");
        await stage(job, "ingest", PY, [
          "scripts/realbank/convert_docx_set.py", "--dir", setDir, "--out-name", row.set_name,
        ]);
        await runFirstPdf(job, row.set_name, path.join(OUT_DIR, "src-converted"), result);
      } else {
        await runFirstPdf(job, row.set_name, path.dirname(setDir), result);
      }
      await job.patch({ set_key: result.set_key });
      midStagesOk = true;

      await tailStages(job, { setKey: result.set_key, result, opts });
    }

    // ── push_artifacts ──
    await job.enter("push_artifacts");
    if (opts.skipSync) {
      await job.log("--skip-sync，不回传产物", "warn");
    } else {
      const p = await artifactsPush(sb, { log: (m) => console.log(m) });
      await job.log(`产物回传：上传 ${p.uploaded} 个`);
    }

    // ── cleanup ──
    if (row.kind !== "rebuild") {
      await job.enter("cleanup");
      const removed = await deleteSources(job, sb);
      await job.log(`源文件清理：删了 ${removed} 个对象`);
      fs.rmSync(path.join(JOBS_DIR, String(job.id)), { recursive: true, force: true });
    }

    await job.patch({ status: "done", stage: null, result, error: null });
    await job.log(`完成。新增 ${JSON.stringify(result.added || {})}；扣留 ${(result.holds || []).length} 条`, "info", null);
  } catch (e) {
    const msg = e instanceof StageError ? e.message : `${e && e.message ? e.message : e}`;
    await job.log(msg, "error");
    // 失败时**不**回传产物（半截产物会污染下一个 job 的基线）。例外：ingest/structure/audit
    // 三段已经成功、只是后段挂了 —— 那批产物是花过钱的，传上去下次重跑能省一次结构化。
    if (!opts.skipSync && artifactsPulled && midStagesOk) {
      try {
        const p = await artifactsPush(sb, { log: (m) => console.log(m) });
        await job.log(`前三段产物已回传（${p.uploaded} 个），重跑可省一次结构化`, "warn");
      } catch (e2) {
        await job.log(`产物回传也失败：${e2.message}`, "warn");
      }
    }
    await job.patch({ status: "failed", error: msg.slice(0, 2000), result });
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
