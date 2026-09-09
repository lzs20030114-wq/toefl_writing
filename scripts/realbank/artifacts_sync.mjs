#!/usr/bin/env node
/**
 * 中间产物同步（契约 §2）—— `.codex-tmp/` ↔ Supabase Storage 桶 `real_bank_artifacts`。
 *
 * 为什么非有不可：`build_bank.mjs` 是**全量重建** —— 它把 `.codex-tmp/realbank/*.structured.json`
 * 连同 `*.audit.json` 一起汇总成整个 data/realBank/**。云端 runner 每次都是空盘，
 * 不先把这 80 多套卷的中间产物拉下来就 build，产出的不是「新增一套」而是
 * 「只剩这一套」—— 一次 push 就能把线上题库从 1202 题打回几十题。
 *
 * 所以布局与本机 `.codex-tmp/` **一一对应**（桶里 `realbank/x` ↔ 本机 `.codex-tmp/realbank/x`），
 * 同步是白名单式的增量（size + mtime 变了才传）：
 *
 *   白名单            .codex-tmp/realbank/*.json（排除 *.prev.json）
 *                     .codex-tmp/realbank/{asr,asr-vendor,bs-ocr,_review}/**
 *                     .codex-tmp/realbank/material-images/manifest.json
 *                     .codex-tmp/ocr/**
 *   排除              src-converted/ bs-pages/ audio/ _bank_before/ logs/
 *                     （都是能从源文件/成品重算出来的大件：本机 659MB 里 650MB 是它们）
 *
 * 桶根维护一份 `realbank/_manifest.json`（每文件 size+mtime+sha1 + structured 计数），
 * Worker 用它做「pull 下来的 structured 数量 ≥ 上次 push 时的数量」这道 fail-closed 校验。
 *
 * 用法:
 *   node scripts/realbank/artifacts_sync.mjs --pull [--dry]
 *   node scripts/realbank/artifacts_sync.mjs --push [--dry]
 *   node scripts/realbank/artifacts_sync.mjs --push --only realbank/3.24新托福真题.structured.json
 *   （本机跑会自动读 .env.local；Actions 上靠 env）
 *
 * 对象 key：桶里存的是 `objectKey.mjs` 编码后的 key（Supabase 的 isValidKey 不收中文/空格，
 * `ocr/1.21新托福真题B卷__….txt` 会被服务端直接 400）。清单 `_manifest.json` 里记的仍是
 * **原始相对路径**，编码只发生在真正调 upload/download 的那一行。
 *
 * 退出码：0 正常；1 有文件传/收失败（清单不写）；2 用法错误；3 Supabase 不可用。
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { encodeObjectPath, decodeObjectPath } from "../../lib/realBankIngest/objectKey.mjs";

export const BUCKET = "real_bank_artifacts";
export const MANIFEST_KEY = "realbank/_manifest.json"; // 全 ASCII，无需编码

/**
 * 传/收有文件失败 —— CLI 用 `exitCode` 区分「同步没做完」(退出码 1) 与「环境不可用」(3)。
 * 故意用工厂而不是 `class extends Error`：jest 的 transform 会把原生子类降级，
 * instanceof 与 name 都对不上，判据就不可靠了。
 */
export function SyncFailure(message) {
  const e = new Error(message);
  e.name = "SyncFailure";
  e.exitCode = 1;
  return e;
}

const ROOT = process.cwd();
const TMP = path.join(ROOT, ".codex-tmp");
/** 单文件上限：Supabase 免费档对象上限 50MB，留余量按 45MB 判，超了跳过并告警。 */
const MAX_FILE_BYTES = 45 * 1024 * 1024;
/** 并发：Storage 侧撑得住，瓶颈在往返延迟。 */
const CONCURRENCY = 6;

/* ── 白名单（契约 §2） ───────────────────────────────────────────────────── */

/**
 * 判一个相对 `.codex-tmp/` 的路径要不要同步。
 * 纯函数，单测在 __tests__/realbank-artifacts-sync.test.js。
 */
export function isSynced(rel) {
  const p = String(rel || "").replace(/\\/g, "/");
  if (!p) return false;
  if (p.startsWith("ocr/")) return true;
  if (!p.startsWith("realbank/")) return false;
  const tail = p.slice("realbank/".length);
  if (!tail || tail.includes("..")) return false;

  // realbank/ 顶层：只要 *.json，且排除 *.prev.json（那是上一版备份，重建用不上）
  if (!tail.includes("/")) return tail.endsWith(".json") && !tail.endsWith(".prev.json");

  const dir = tail.slice(0, tail.indexOf("/"));
  if (["asr", "asr-vendor", "bs-ocr", "_review"].includes(dir)) return true;
  // 材料图本体已经在公开桶 real_bank_images 里了，这边只要 manifest（决定哪些图算校验通过）
  if (dir === "material-images") return tail === "material-images/manifest.json";
  return false; // src-converted / bs-pages / audio / _bank_before / logs 一律不传
}

/* ── env / client ────────────────────────────────────────────────────────── */

function loadEnv() {
  for (const p of [".env.local", ".env"]) {
    try {
      fs.readFileSync(path.join(ROOT, p), "utf8").split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*(\w+)\s*=\s*(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
      });
    } catch { /* 没有 .env 就靠进程环境变量（Actions 走这条） */ }
  }
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** 桶不存在就建（私有）。已存在 / 并发撞车都算成功 —— 与 lib/wechatQr/storage.js 同一套路。 */
export async function ensureBucket(sb) {
  const { data: existing } = await sb.storage.getBucket(BUCKET);
  if (existing) return "已存在";
  const { error } = await sb.storage.createBucket(BUCKET, { public: false });
  if (error && !/already exists|duplicate/i.test(String(error.message || ""))) {
    throw new Error(`创建存储桶失败: ${error.message}`);
  }
  return "已创建";
}

/* ── 本地清单 ────────────────────────────────────────────────────────────── */

const sha1 = (buf) => crypto.createHash("sha1").update(buf).digest("hex");

/** 扫本地 `.codex-tmp/`，返回 { rel: {size, mtime, sha1} }（只含白名单内的文件）。 */
export function scanLocal(tmpDir = TMP) {
  const out = {};
  const walk = (abs, rel) => {
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      const a = path.join(abs, e.name);
      if (e.isDirectory()) {
        // 早剪枝：src-converted / audio 里有上万个文件，逐个问 isSynced 是白烧几秒
        if (!rel && !["realbank", "ocr"].includes(e.name)) continue;
        if (rel === "realbank" && ["src-converted", "bs-pages", "audio", "_bank_before", "logs"].includes(e.name)) continue;
        walk(a, r);
      } else if (e.isFile() && isSynced(r)) {
        const st = fs.statSync(a);
        out[r] = { size: st.size, mtime: Math.round(st.mtimeMs) };
      }
    }
  };
  walk(tmpDir, "");
  return out;
}

/** structured 产物计数 —— 契约 §8 的 fail-closed 校验就看这个数。 */
export const countStructured = (manifestFiles) =>
  Object.keys(manifestFiles || {}).filter((k) => k.endsWith(".structured.json")).length;

async function readManifest(sb) {
  const { data, error } = await sb.storage.from(BUCKET).download(MANIFEST_KEY);
  if (error || !data) return { files: {}, structured: 0, updated_at: null };
  try { return JSON.parse(await data.text()); } catch { return { files: {}, structured: 0, updated_at: null }; }
}

/* ── 并发小工具 ──────────────────────────────────────────────────────────── */
async function pool(items, n, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(n, queue.length) }, async () => {
    for (let it = queue.shift(); it !== undefined; it = queue.shift()) await fn(it);
  });
  await Promise.all(workers);
}

/* ── push ────────────────────────────────────────────────────────────────── */

export async function push(sb, { dry = false, only = null, log = console.log } = {}) {
  await ensureBucket(sb);
  const remote = await readManifest(sb);
  const local = scanLocal();

  const changed = [];
  const skippedBig = [];
  for (const [rel, meta] of Object.entries(local)) {
    if (only && rel !== only) continue;
    if (meta.size > MAX_FILE_BYTES) { skippedBig.push(rel); continue; }
    const prev = remote.files && remote.files[rel];
    if (prev && prev.size === meta.size && prev.mtime === meta.mtime) continue;
    changed.push(rel);
  }

  log(`■ push：本地白名单内 ${Object.keys(local).length} 个文件，`
    + `其中新增/变更 ${changed.length} 个（远端清单 ${Object.keys(remote.files || {}).length} 个）`);
  if (skippedBig.length) log(`  ⚠ 超过 ${MAX_FILE_BYTES / 1024 / 1024}MB 跳过：${skippedBig.join(", ")}`);
  if (dry) { log("（--dry，未上传）"); return { changed, uploaded: 0, skippedBig }; }

  let uploaded = 0;
  const failed = [];
  const files = { ...(remote.files || {}) };
  await pool(changed, CONCURRENCY, async (rel) => {
    try {
      const buf = fs.readFileSync(path.join(TMP, rel));
      const { error } = await sb.storage.from(BUCKET).upload(encodeObjectPath(rel), buf, {
        upsert: true, contentType: "application/octet-stream",
      });
      if (error) { failed.push(`${rel}: ${error.message}`); return; }
      files[rel] = { ...local[rel], sha1: sha1(buf) };
      uploaded += 1;
      if (uploaded % 25 === 0) log(`  … ${uploaded}/${changed.length}`);
    } catch (e) {
      // storage-js 偶尔是抛而不是返回 {error}；抛出去会让整个 pool 炸掉、
      // 失败清单丢失（历史上这条路径把退出码也带成了 0）。统一收集。
      failed.push(`${rel}: ${(e && e.message) || e}`);
    }
  });

  if (failed.length) {
    // 有文件没传上去就**不写清单**：清单一旦写了新数字，下次 pull 的 fail-closed 校验
    // 就会拿一个我们其实没传完的基线去比，等于自己把闸门解除了。
    throw SyncFailure(`有 ${failed.length} 个文件上传失败，清单未更新：\n  ${failed.slice(0, 5).join("\n  ")}`);
  }

  // 本地已删掉的文件从清单里摘掉（--only 模式不做，它只碰一个文件）
  if (!only) for (const rel of Object.keys(files)) if (!local[rel]) delete files[rel];

  const manifest = {
    _purpose: "real_bank_artifacts 桶的文件清单。Worker pull 后拿 structured 计数做 fail-closed 校验。",
    updated_at: new Date().toISOString(),
    structured: countStructured(files),
    count: Object.keys(files).length,
    files,
  };
  const { error } = await sb.storage.from(BUCKET).upload(
    MANIFEST_KEY, Buffer.from(JSON.stringify(manifest, null, 1), "utf8"),
    { upsert: true, contentType: "application/json" });
  if (error) throw new Error(`清单写入失败: ${error.message}`);
  log(`  ✓ 上传 ${uploaded} 个；清单 ${manifest.count} 个文件 / structured ${manifest.structured} 套`);
  return { changed, uploaded, skippedBig, manifest };
}

/* ── pull ────────────────────────────────────────────────────────────────── */

export async function pull(sb, { dry = false, log = console.log } = {}) {
  await ensureBucket(sb);
  const remote = await readManifest(sb);
  const remoteFiles = remote.files || {};
  if (!Object.keys(remoteFiles).length) {
    log("■ pull：远端清单为空（桶还没灌过），跳过");
    return { downloaded: 0, structured: 0, empty: true };
  }
  const local = scanLocal();

  const todo = Object.keys(remoteFiles).filter((rel) => {
    if (!isSynced(rel)) return false;                       // 清单被人动过手脚也不越界写盘
    const l = local[rel];
    return !l || l.size !== remoteFiles[rel].size || l.mtime !== remoteFiles[rel].mtime;
  });

  log(`■ pull：远端 ${Object.keys(remoteFiles).length} 个文件（structured ${remote.structured ?? "?"} 套），`
    + `本地缺/不一致 ${todo.length} 个`);
  if (dry) { log("（--dry，未下载）"); return { todo, downloaded: 0, structured: remote.structured || 0 }; }

  let downloaded = 0;
  const failed = [];
  await pool(todo, CONCURRENCY, async (rel) => {
    let data; let error;
    try {
      ({ data, error } = await sb.storage.from(BUCKET).download(encodeObjectPath(rel)));
    } catch (e) { failed.push(`${rel}: ${(e && e.message) || e}`); return; }
    if (error || !data) { failed.push(`${rel}: ${error && error.message}`); return; }
    // 清单里的 key 已经是原始相对路径了，这里 decode 是防御：万一有人把编码 key 写进了清单。
    const abs = path.join(TMP, decodeObjectPath(rel));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from(await data.arrayBuffer()));
    // mtime 对齐远端记录：否则下一次 push 会因为「mtime 变了」把刚拉下来的文件原样再传一遍。
    const m = remoteFiles[rel].mtime;
    if (m) { try { fs.utimesSync(abs, m / 1000, m / 1000); } catch { /* 时间戳设不上不影响正确性 */ } }
    downloaded += 1;
    if (downloaded % 25 === 0) log(`  … ${downloaded}/${todo.length}`);
  });
  if (failed.length) {
    throw SyncFailure(`有 ${failed.length} 个文件下载失败：\n  ${failed.slice(0, 5).join("\n  ")}`);
  }

  const after = countStructured(scanLocal());
  log(`  ✓ 下载 ${downloaded} 个；本地 structured ${after} 套（远端清单记 ${remote.structured ?? "?"}）`);
  return { downloaded, structured: remote.structured || 0, localStructured: after };
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */
const isMain = Boolean(process.argv[1]) && path.basename(process.argv[1]) === "artifacts_sync.mjs";
if (isMain) {
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry");
  const only = (() => { const i = argv.indexOf("--only"); return i >= 0 ? argv[i + 1] : null; })();
  const mode = argv.includes("--pull") ? "pull" : argv.includes("--push") ? "push" : null;
  if (!mode) {
    console.error("用法: node scripts/realbank/artifacts_sync.mjs --pull|--push [--dry] [--only <相对路径>]");
    process.exit(2);
  }
  loadEnv();
  const sb = admin();
  if (!sb) {
    console.error("缺 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(3);
  }
  (mode === "pull" ? pull(sb, { dry }) : push(sb, { dry, only }))
    .then((res) => {
      // 双保险：万一将来有人在 push/pull 里把失败降级成返回值而不是抛，也别退 0。
      const bad = res && Array.isArray(res.failed) && res.failed.length;
      process.exit(bad ? 1 : 0);
    })
    .catch((e) => {
      console.error(String((e && e.message) || e));
      process.exit(Number(e && e.exitCode) || 3);
    });
}
