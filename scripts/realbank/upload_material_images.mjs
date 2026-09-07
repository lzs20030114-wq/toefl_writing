#!/usr/bin/env node
/**
 * 真题阅读「材料框原图」—— 上传 Supabase + 回写题库字段。
 *
 * 上游是 scripts/realbank/crop_materials.py：它把材料框裁出来、过完 fail-closed 三连校验，
 * 结果落在 .codex-tmp/realbank/material-images/{<item_id>.webp, manifest.json}。
 * 本脚本只做两件事，且**只认 manifest 里 verified:true 的项**（校验没过的图留在本地，
 * 既不上传也不写库 —— 宁可这条题继续用纯文本，也不能把切错的图摆给用户）：
 *   1) 传进公开桶 `real_bank_images`，路径 `reading/<item_id>.webp`（upsert，重跑幂等）；
 *   2) 给 data/realBank/reading/{rdl,ap}.json 对应 item **新增** 可选字段
 *      material_image = { url, w, h, source_page }。既有字段一个不动。
 *
 * url 存 Supabase 公开 URL；前端 lib/realBank.js 的 materialImageSrc() 会把它改写成
 * 同源 /api/img/... （国内直连 supabase.co 不通，与听力音频同一套路数）。
 *
 * 用法:
 *   node --env-file=.env.local scripts/realbank/upload_material_images.mjs --dry-run
 *   node --env-file=.env.local scripts/realbank/upload_material_images.mjs
 *   node --env-file=.env.local scripts/realbank/upload_material_images.mjs --ids a,b
 *
 * 退出码：0 正常；2 用法/输入缺失；3 Supabase 不可用。
 */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const REPO_ROOT = process.cwd();
const IMG_DIR = path.join(REPO_ROOT, ".codex-tmp", "realbank", "material-images");
const MANIFEST = path.join(IMG_DIR, "manifest.json");
const BANK_DIR = path.join(REPO_ROOT, "data", "realBank", "reading");
export const MATERIAL_BUCKET = "real_bank_images";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const DRY = has("--dry-run");
const ONLY = (val("--ids") || "").split(",").map((s) => s.trim()).filter(Boolean);

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

function readManifest() {
  if (!fs.existsSync(MANIFEST)) {
    console.error(`找不到 ${MANIFEST}，先跑 python scripts/realbank/crop_materials.py --all`);
    return null;
  }
  const j = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  let recs = (j.records || []).filter((r) => r.verified === true);
  if (ONLY.length) recs = recs.filter((r) => ONLY.includes(r.item_id));
  return recs;
}

/** 只新增 material_image，其余字段（含键序）原样保留。 */
function writeBanks(byId) {
  const stats = { rdl: 0, ap: 0 };
  for (const kind of ["rdl", "ap"]) {
    const p = path.join(BANK_DIR, `${kind}.json`);
    const bank = JSON.parse(fs.readFileSync(p, "utf8"));
    let touched = 0;
    for (const item of bank.items || []) {
      const rec = byId.get(item.id);
      if (!rec) continue;
      const next = { url: rec.url, w: rec.w, h: rec.h, source_page: rec.page };
      if (JSON.stringify(item.material_image) === JSON.stringify(next)) continue;
      item.material_image = next; // 追加在末尾 → diff 只多一块，不打乱既有键序
      touched += 1;
    }
    stats[kind] = touched;
    if (touched && !DRY) fs.writeFileSync(p, JSON.stringify(bank, null, 2), "utf8");
  }
  return stats;
}

async function main() {
  const recs = readManifest();
  if (!recs) return 2;
  if (!recs.length) {
    console.log("manifest 里没有 verified:true 的项，无事可做。");
    return 0;
  }

  let bytes = 0;
  for (const r of recs) {
    const f = r.file || path.join(IMG_DIR, `${r.item_id}.webp`);
    if (!fs.existsSync(f)) {
      console.error(`[缺图] ${r.item_id} → ${f}`);
      return 2;
    }
    r.file = f;
    r.size = fs.statSync(f).size;
    bytes += r.size;
  }
  console.log(`■ 待上传 ${recs.length} 张，总计 ${(bytes / 1024).toFixed(0)} KB`
    + `（${(bytes / 1024 / 1024).toFixed(2)} MB）→ 桶 ${MATERIAL_BUCKET}/reading/`);

  const sb = admin();
  if (!sb) {
    if (DRY) {
      console.log("（--dry-run，且未配置 Supabase：只报数）");
      return 0;
    }
    console.error("Supabase 未配置（NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）");
    return 3;
  }

  if (DRY) {
    for (const r of recs) console.log(`  · ${r.item_id}  ${r.w}x${r.h}  ${(r.size / 1024).toFixed(0)}KB`);
    console.log("（--dry-run，未上传、未写库）");
    return 0;
  }

  console.log(`桶状态：${await ensureBucket(sb)}`);

  const byId = new Map();
  let uploaded = 0;
  for (const r of recs) {
    const key = `reading/${r.item_id}.webp`;
    const buf = fs.readFileSync(r.file);
    const { error } = await sb.storage.from(MATERIAL_BUCKET)
      .upload(key, buf, { contentType: "image/webp", upsert: true });
    if (error) {
      console.error(`[失败] ${r.item_id}: ${error.message}`);
      continue;
    }
    const { data } = sb.storage.from(MATERIAL_BUCKET).getPublicUrl(key);
    byId.set(r.item_id, { url: data.publicUrl, w: r.w, h: r.h, page: r.page ?? null });
    uploaded += 1;
    console.log(`  [${uploaded}/${recs.length}] ✓ ${key}`);
  }

  const stats = writeBanks(byId);
  console.log(`\n完成：上传 ${uploaded} 张（${(bytes / 1024).toFixed(0)} KB），`
    + `写库 rdl ${stats.rdl} 条 + ap ${stats.ap} 条。`);
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
