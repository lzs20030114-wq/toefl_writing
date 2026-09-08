/**
 * 微信群二维码——后台可换图的存储层。
 *
 * 为什么不直接覆盖 public/wechat-group-qr.jpg：Vercel 运行时是只读文件系统，
 * 改静态文件只能走 git 提交 + 重新部署。所以「后台拖图即生效」必须把图放到
 * Supabase Storage（bucket `app_assets`，固定对象键 `wechat/group-qr`）。
 *
 * - 建桶：首次上传时用 service role 自动建（public bucket），不需要跑 SQL 迁移。
 * - 对象键固定、无扩展名：换图 = 同键 upsert；content-type 以真实字节嗅探为准。
 * - 前台不直连 supabase.co（国内不可达），走同源 Edge 代理 /api/wechat-qr。
 * - 没上传过 / Storage 未配置 → 代理回退到 public/wechat-group-qr.jpg（内置默认图）。
 *
 * 缓存策略：对象自带 cacheControl=60s，代理响应也是 60s；正常用户最多 ~2 分钟看到新图，
 * 后台预览带 ?v=时间戳 直接穿透两级缓存，上传完立刻能看到。
 */
const { sniffImageMime } = require("../userBank/imageSniff");

const BUCKET = "app_assets";
const OBJECT_KEY = "wechat/group-qr";
const OBJECT_DIR = "wechat";
const OBJECT_NAME = "group-qr";
const MAX_BYTES = 3 * 1024 * 1024; // 微信群二维码截图通常 100~500KB，3MB 足够且远低于 Vercel body 上限
const CACHE_SECONDS = 60;
const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp"];

// 与 lib/tts/storage.js 相同的懒加载，避免脚本环境下的循环依赖。
let _admin;
function getAdmin() {
  if (_admin !== undefined) return _admin;
  try {
    const { supabaseAdmin } = require("../supabaseAdmin");
    _admin = supabaseAdmin || null;
  } catch {
    _admin = null;
  }
  return _admin;
}

/** 校验上传字节：非空 / 体积门 / magic-byte 嗅探（无视客户端声明的 Content-Type）。 */
function validateQrImage(buf) {
  if (!buf || buf.length === 0) return { ok: false, status: 400, error: "图片为空" };
  if (buf.length > MAX_BYTES) {
    return { ok: false, status: 413, error: `图片过大（>${Math.round(MAX_BYTES / 1024 / 1024)}MB），请压缩后重试` };
  }
  const mime = sniffImageMime(buf);
  if (!mime || !ALLOWED_MIMES.includes(mime)) {
    return { ok: false, status: 415, error: "仅支持 JPEG / PNG / WebP 图片" };
  }
  return { ok: true, mime };
}

/** 桶不存在就建（public）。已存在视为成功；并发建桶撞上 "already exists" 也视为成功。 */
async function ensureBucket(admin) {
  const { data: existing } = await admin.storage.getBucket(BUCKET);
  if (existing) return;
  const { error } = await admin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: MAX_BYTES,
    allowedMimeTypes: ALLOWED_MIMES,
  });
  if (error && !/already exists|duplicate/i.test(String(error.message || ""))) {
    throw new Error(`创建存储桶失败: ${error.message}`);
  }
}

/**
 * 上传（覆盖）二维码。
 * @param {Buffer|Uint8Array} buf 已通过 validateQrImage 的字节
 * @param {string} mime 嗅探出的真实类型
 */
async function uploadQr(buf, mime) {
  const admin = getAdmin();
  if (!admin) throw new Error("Supabase admin is not configured");
  await ensureBucket(admin);
  const { error } = await admin.storage.from(BUCKET).upload(OBJECT_KEY, buf, {
    contentType: mime,
    upsert: true,
    cacheControl: String(CACHE_SECONDS),
  });
  if (error) throw new Error(`上传失败: ${error.message}`);
  return { key: OBJECT_KEY, mime, size: buf.length, updatedAt: new Date().toISOString() };
}

/** 当前自定义二维码的元数据；没上传过返回 { exists: false }。 */
async function getQrStatus() {
  const admin = getAdmin();
  if (!admin) return { configured: false, exists: false };
  const { data, error } = await admin.storage.from(BUCKET).list(OBJECT_DIR, { search: OBJECT_NAME });
  // 桶还没建（从未上传过）→ list 会报错，等价于「不存在」。
  if (error) return { configured: true, exists: false };
  const obj = (data || []).find((o) => o && o.name === OBJECT_NAME);
  if (!obj) return { configured: true, exists: false };
  return {
    configured: true,
    exists: true,
    updatedAt: obj.updated_at || obj.created_at || null,
    size: obj.metadata && typeof obj.metadata.size === "number" ? obj.metadata.size : null,
    mime: (obj.metadata && obj.metadata.mimetype) || null,
  };
}

/** 删除自定义二维码 → 前台回退到内置默认图。对象不存在也算成功。 */
async function deleteQr() {
  const admin = getAdmin();
  if (!admin) throw new Error("Supabase admin is not configured");
  const { error } = await admin.storage.from(BUCKET).remove([OBJECT_KEY]);
  if (error && !/not found/i.test(String(error.message || ""))) {
    throw new Error(`删除失败: ${error.message}`);
  }
  return { ok: true };
}

module.exports = {
  BUCKET,
  OBJECT_KEY,
  MAX_BYTES,
  CACHE_SECONDS,
  ALLOWED_MIMES,
  validateQrImage,
  ensureBucket,
  uploadQr,
  getQrStatus,
  deleteQr,
};
