#!/usr/bin/env node
/**
 * 真题复述题「场景插图」—— 上传 Supabase + 回写题库字段。
 *
 * 上游是 scripts/realbank/crop_repeat_scenes.py：它把真考那张常驻场景图（无高亮底图）和
 * 每一句的高亮帧裁出来、过完 Qwen 判读 + 人工放行/排除清单，结果落在
 * .codex-tmp/realbank/repeat-scenes/{*.webp, manifest.json}。
 * 本脚本只做两件事，且**只认 verified:true 且没被 excluded / 整套 skipped 的图**
 * （校验没过的留在本地，既不上传也不写库 —— 宁可这套继续纯文本，也不能把切错 / 商家自绘的
 * 图摆给用户）：
 *   1) 传进公开桶 `real_bank_images`：
 *        底图     speaking/repeat/<item_id>.webp
 *        逐句帧   speaking/repeat/<item_id>_q<n>.webp        （n = **真题题号**）
 *      upsert，重跑幂等；
 *   2) 给 data/realBank/speaking/repeat.json 对应 item **新增**两个可选字段：
 *        scene_image     = { url, w, h, source_page }
 *        sentence_frames = [ { sentence_id, n, url, w, h }, … ]
 *      既有字段（含键序）一个不动。
 *
 * ★ 对齐一律靠 sentence_id，不靠文件名 / 后缀：题库句子 id 的 `_s<k>` 后缀**不等于**真题题号
 *   （3.15 / 4.20 / 5.23 三套录入时丢了靠前的句子、剩下的又连号重排）。manifest 的
 *   sentence_to_frame 是人眼核过的「句子号 → 真题题号」表（依据写在
 *   data/realBank/scene-image-overrides.json 的 _pairing 里），本脚本按它把帧挂到句子 id 上；
 *   表里没有的帧不写库、也不上传。
 *
 * ★ 特例 low_contrast_highlight（目前只有 21b / real_repeat_21b_1）：源是灰度扫描件，
 *   高亮肉眼不可辨，逐句帧摆出来只会让用户以为「图没变」。按 manifest 的这个标记通用处理 ——
 *   **有该标记且没有可用底图时，取题号最小的那一帧当底图，且一条 sentence_frames 都不写**。
 *
 * url 存 Supabase 公开 URL；前端 lib/realBank.js 的 mapSceneImage/mapSentenceFrames 会把它
 * 改写成同源 /api/img/…（国内直连 supabase.co 不通，与阅读材料原图同一套路数）。
 *
 * 用法:
 *   node --env-file=.env.local scripts/realbank/upload_repeat_scenes.mjs --dry
 *   node --env-file=.env.local scripts/realbank/upload_repeat_scenes.mjs
 *   node --env-file=.env.local scripts/realbank/upload_repeat_scenes.mjs --set 315
 *
 * 退出码：0 正常；2 用法/输入缺失；3 Supabase 不可用 / 上传失败。
 */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

// 与 upload_material_images.mjs 同一个公开桶（那边导出了同名常量，但那个模块顶层就调 main()，
// import 一下就会顺手把阅读材料图也传一遍 —— 所以这里照抄字面量，不 import）。
const MATERIAL_BUCKET = "real_bank_images";

const REPO_ROOT = process.cwd();
const IMG_DIR = path.join(REPO_ROOT, ".codex-tmp", "realbank", "repeat-scenes");
const MANIFEST = path.join(IMG_DIR, "manifest.json");
const BANK = path.join(REPO_ROOT, "data", "realBank", "speaking", "repeat.json");
const PREFIX = "speaking/repeat";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const DRY = has("--dry") || has("--dry-run");
const ONLY = (val("--set") || "").trim();

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** 建桶：已存在就当成功（重跑不该因为「桶已在」而失败）。 */
async function ensureBucket(sb) {
  const { error } = await sb.storage.createBucket(MATERIAL_BUCKET, {
    public: true,
    fileSizeLimit: "5MB",
    allowedMimeTypes: ["image/webp", "image/png", "image/jpeg"],
  });
  if (!error) return "created";
  if (/exist/i.test(error.message || "")) return "exists";
  throw new Error(`createBucket 失败：${error.message}`);
}

const usable = (img) => !!(img && img.verified === true && !img.excluded);

/**
 * manifest × 题库 → 每套的上传/写库计划。
 * 返回 [{ item, setId, base?, frames: [{ sentenceId, n, img }] }]，base/frames 里的 img
 * 是 manifest 里那条记录（带 file / w / h / page）。
 */
function buildPlan(manifest, items) {
  const bySet = new Map();
  for (const it of items) {
    const m = /^real_repeat_(.+?)_\d+$/.exec(String(it?.id || ""));
    if (m) bySet.set(m[1], it);
  }
  const plan = [];
  const warn = [];
  for (const s of manifest.sets || []) {
    if (s.skipped) continue;
    if (ONLY && s.set_id !== ONLY) continue;
    const item = bySet.get(s.set_id);
    if (!item) { warn.push(`[跳过] ${s.set_id}：题库里没有对应的套`); continue; }
    const framesOk = (s.frames || []).filter(usable);
    let base = usable(s.base) ? s.base : null;
    let frames = [];

    if (s.low_contrast_highlight && !base) {
      // 灰度扫描件：高亮不可辨 → 最小题号那帧当底图，不写逐句帧（见文件头注）。
      const first = framesOk.slice().sort((a, b) => a.n - b.n)[0];
      if (first) base = first;
      if (first) warn.push(`[低对比] ${s.set_id}：Q${first.n} 当底图，不写 sentence_frames`);
    } else {
      // 句子 id 的 _s<k> 后缀 → sentence_to_frame → 真题题号 → 帧。
      const s2f = s.sentence_to_frame || {};
      const byN = new Map(framesOk.map((f) => [Number(f.n), f]));
      for (const sent of item.sentences || []) {
        const m = /_s(\d+)$/.exec(String(sent?.id || ""));
        if (!m) continue;
        const n = Number(s2f[m[1]]);
        if (!Number.isInteger(n)) continue;
        const img = byN.get(n);
        if (img) frames.push({ sentenceId: sent.id, n, img });
      }
      const unused = framesOk.length - frames.length;
      if (unused > 0) warn.push(`[未挂上] ${s.set_id}：${unused} 张帧在 sentence_to_frame 里没有对应句子，不传不写`);
    }
    if (!base && !frames.length) continue;
    plan.push({ item, setId: s.set_id, base, frames });
  }
  return { plan, warn };
}

/** 检查本地文件都在，并统计字节数。 */
function checkFiles(plan) {
  let bytes = 0;
  const missing = [];
  for (const row of plan) {
    for (const img of [row.base, ...row.frames.map((f) => f.img)].filter(Boolean)) {
      const f = img.file || "";
      if (!f || !fs.existsSync(f)) { missing.push(`${row.setId} → ${f || "(无 file 字段)"}`); continue; }
      bytes += fs.statSync(f).size;
    }
  }
  return { bytes, missing };
}

/** 只新增 scene_image / sentence_frames，其余字段（含键序）原样保留。 */
function writeBank(results) {
  const bank = JSON.parse(fs.readFileSync(BANK, "utf8"));
  const byId = new Map(results.map((r) => [r.item.id, r]));
  let base = 0;
  let frames = 0;
  let sets = 0;
  for (const item of bank.items || []) {
    const r = byId.get(item.id);
    if (!r) continue;
    let touched = false;
    if (r.sceneImage) {
      if (JSON.stringify(item.scene_image) !== JSON.stringify(r.sceneImage)) {
        item.scene_image = r.sceneImage; // 追加在末尾 → diff 只多一块，不打乱既有键序
        touched = true;
      }
      base += 1;
    }
    if (r.sentenceFrames && r.sentenceFrames.length) {
      if (JSON.stringify(item.sentence_frames) !== JSON.stringify(r.sentenceFrames)) {
        item.sentence_frames = r.sentenceFrames;
        touched = true;
      }
      frames += r.sentenceFrames.length;
    }
    if (touched) sets += 1;
  }
  if (sets && !DRY) fs.writeFileSync(BANK, JSON.stringify(bank, null, 2), "utf8");
  return { sets, base, frames };
}

/** 抽验：GET 三个 URL，看 200 + image/webp。 */
async function spotCheck(urls) {
  for (const u of urls) {
    try {
      const res = await fetch(u);
      console.log(`  抽验 ${res.status} ${res.headers.get("content-type")}  ${u}`);
    } catch (e) {
      console.log(`  抽验失败 ${u}: ${e.message}`);
    }
  }
}

async function main() {
  if (!fs.existsSync(MANIFEST)) {
    console.error(`找不到 ${MANIFEST}，先跑 python scripts/realbank/crop_repeat_scenes.py`);
    return 2;
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const bank = JSON.parse(fs.readFileSync(BANK, "utf8"));
  const { plan, warn } = buildPlan(manifest, bank.items || []);
  for (const w of warn) console.log(w);
  if (!plan.length) { console.log("没有可上传的图，无事可做。"); return 0; }

  const { bytes, missing } = checkFiles(plan);
  if (missing.length) {
    console.error(`[缺图] ${missing.length} 张本地文件不存在：`);
    for (const m of missing.slice(0, 10)) console.error(`  · ${m}`);
    return 2;
  }
  const nBase = plan.filter((r) => r.base).length;
  const nFrames = plan.reduce((a, r) => a + r.frames.length, 0);
  console.log(`\n■ 将上传 ${nBase + nFrames} 张（底图 ${nBase} + 逐句帧 ${nFrames}），`
    + `${(bytes / 1024 / 1024).toFixed(2)} MB → 桶 ${MATERIAL_BUCKET}/${PREFIX}/`);
  console.log(`■ 将写库 ${plan.length} 套（data/realBank/speaking/repeat.json）`);

  if (DRY) {
    for (const r of plan) {
      console.log(`  · ${r.item.id}  底图 ${r.base ? "有" : "—"}  帧 ${r.frames.length}`
        + (r.frames.length ? `  (Q${r.frames.map((f) => f.n).join("/")})` : ""));
    }
    console.log("（--dry，未上传、未写库）");
    return 0;
  }

  const sb = admin();
  if (!sb) {
    console.error("Supabase 未配置（NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）");
    return 3;
  }
  console.log(`桶状态：${await ensureBucket(sb)}`);

  const results = [];
  let uploaded = 0;
  let failed = 0;
  const sample = [];
  for (const row of plan) {
    const jobs = [];
    if (row.base) jobs.push({ kind: "base", key: `${PREFIX}/${row.item.id}.webp`, img: row.base });
    for (const f of row.frames) {
      jobs.push({ kind: "frame", key: `${PREFIX}/${row.item.id}_q${f.n}.webp`, img: f.img, f });
    }
    const out = { item: row.item, sceneImage: null, sentenceFrames: [] };
    for (const job of jobs) {
      const buf = fs.readFileSync(job.img.file);
      const { error } = await sb.storage.from(MATERIAL_BUCKET)
        .upload(job.key, buf, { contentType: "image/webp", upsert: true });
      if (error) {
        // 系统性失败（鉴权 / 网络）立刻停：继续跑只会把同一个错误刷 190 遍。
        console.error(`[失败] ${job.key}: ${error.message}`);
        failed += 1;
        if (failed >= 3) { console.error("连续失败，判为系统性问题，停。"); return 3; }
        continue;
      }
      const { data } = sb.storage.from(MATERIAL_BUCKET).getPublicUrl(job.key);
      uploaded += 1;
      if (sample.length < 3) sample.push(data.publicUrl);
      if (job.kind === "base") {
        out.sceneImage = {
          url: data.publicUrl, w: job.img.w, h: job.img.h, source_page: job.img.page ?? null,
        };
      } else {
        out.sentenceFrames.push({
          sentence_id: job.f.sentenceId, n: job.f.n, url: data.publicUrl, w: job.img.w, h: job.img.h,
        });
      }
    }
    results.push(out);
    console.log(`  ✓ ${row.item.id}  ${jobs.length} 张`);
  }

  const stats = writeBank(results);
  console.log(`\n完成：上传 ${uploaded} 张（失败 ${failed}），`
    + `写库 ${stats.sets} 套（底图 ${stats.base} + 逐句帧 ${stats.frames}）。`);
  if (sample.length) {
    console.log("\n抽验：");
    await spotCheck(sample);
  }
  return failed ? 3 : 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
