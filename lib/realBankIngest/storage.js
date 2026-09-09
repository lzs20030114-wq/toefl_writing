/**
 * 真题自动录入 —— 源文件桶（private bucket `real_bank_sources`）。
 *
 * 为什么要 signed upload URL 而不是走 API 转发字节：一套真题源动辄几百 MB
 * （PDF + 逐题 mp3），Vercel serverless 的 body 上限和执行时长都扛不住。
 * 所以后台只负责「发路径 + 发一次性 token」，字节由浏览器 supabase-js 直传桶。
 *
 * 布局：jobs/<jobId>/<相对源目录路径>。job done 后 Worker 删整目录；failed 保留供 retry。
 * 注意：桶里的对象 key 是**编码后**的（Supabase isValidKey 不收中文/空格，见 objectKey.mjs）；
 * 对外（jobs.files[].path、API 返回的 path）一律还原成原始相对路径，只有 objectPath 是桶内 key。
 * 建桶：首次用 service role 自动建（照 lib/wechatQr/storage.js 的模式），不需要额外迁移。
 */
const { jobObjectPath, jobObjectKey, jobDirPath, MAX_FILE_BYTES } = require("./validate");
const { decodeObjectPath } = require("./objectKey.mjs");

const BUCKET = "real_bank_sources";
const ARTIFACTS_BUCKET = "real_bank_artifacts"; // Worker 端用；这里只导出常量避免两处写死

// 与 lib/wechatQr/storage.js 相同的懒加载，避免脚本环境下的循环依赖。
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

function requireAdmin() {
  const admin = getAdmin();
  if (!admin) throw new Error("Supabase admin 未配置（缺 SUPABASE_SERVICE_ROLE_KEY）");
  return admin;
}

/** 桶不存在就建（private）。已存在 / 并发撞车都视为成功。 */
async function ensureBucket(admin, bucket = BUCKET) {
  const { data: existing } = await admin.storage.getBucket(bucket);
  if (existing) return;
  const { error } = await admin.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: MAX_FILE_BYTES,
  });
  if (error && !/already exists|duplicate/i.test(String(error.message || ""))) {
    throw new Error(`创建存储桶失败: ${error.message}`);
  }
}

/**
 * 给一批文件签直传 URL。
 * @param {string} jobId
 * @param {Array<{path:string}>} files 已过 validateFiles
 * @returns {Promise<Array<{path:string,objectPath:string,signedUrl:string,token:string}>>}
 */
async function createSignedUploads(jobId, files) {
  const admin = requireAdmin();
  await ensureBucket(admin);
  const out = [];
  for (const f of files) {
    jobObjectPath(jobId, f.path); // 非法路径在这里抛，不会漏出桶目录
    const objectPath = jobObjectKey(jobId, f.path); // 桶里存编码 key
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(objectPath);
    if (error) throw new Error(`签发上传地址失败（${f.path}）: ${error.message}`);
    out.push({ path: f.path, objectPath, signedUrl: data.signedUrl, token: data.token });
  }
  return out;
}

/**
 * 递归列出 jobs/<id>/ 下所有对象。
 * @returns {Promise<Array<{path:string,objectPath:string,size:number|null}>>}
 *   `path` = 解码后的原始相对路径（拿去和 jobs.files[].path 比）；
 *   `objectPath` = 桶里真正的 key（拿去 remove/download）。桶/目录不存在 → []。
 */
async function listJobFiles(jobId) {
  const admin = requireAdmin();
  const root = jobDirPath(jobId);
  const found = [];
  const queue = [""];
  let guard = 0;
  while (queue.length) {
    if ((guard += 1) > 400) break; // 目录层级失控时兜底，不做无限递归
    const rel = queue.shift();
    const dir = rel ? `${root}/${rel}` : root;
    const { data, error } = await admin.storage.from(BUCKET).list(dir, { limit: 1000 });
    if (error) return found;
    for (const obj of data || []) {
      if (!obj || !obj.name) continue;
      const childRel = rel ? `${rel}/${obj.name}` : obj.name;
      // Supabase 目录项没有 id/metadata，用它区分文件与子目录。
      if (obj.id == null && obj.metadata == null) queue.push(childRel);
      else {
        found.push({
          path: decodeObjectPath(childRel),
          objectPath: `${root}/${childRel}`,
          size: (obj.metadata && obj.metadata.size) ?? null,
        });
      }
    }
  }
  return found;
}

/** 删除整个 job 目录（cancel / done 后清理）。对象不存在也算成功。 */
async function deleteJobDir(jobId) {
  const admin = requireAdmin();
  const root = jobDirPath(jobId);
  const files = await listJobFiles(jobId);
  if (!files.length) return { removed: 0 };
  const keys = files.map((f) => f.objectPath || `${root}/${f.path}`);
  const { error } = await admin.storage.from(BUCKET).remove(keys);
  if (error && !/not found/i.test(String(error.message || ""))) {
    throw new Error(`删除源文件失败: ${error.message}`);
  }
  return { removed: keys.length };
}

module.exports = {
  BUCKET,
  ARTIFACTS_BUCKET,
  getAdmin,
  ensureBucket,
  createSignedUploads,
  listJobFiles,
  deleteJobDir,
};
