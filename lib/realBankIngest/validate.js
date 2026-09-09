/**
 * 真题自动录入 —— 纯函数入参校验（契约 docs/realbank-ingest-contract.md §3）。
 *
 * 抽成无依赖纯函数的理由：这层是「浏览器直传桶」链路里唯一的守门人——
 * signed upload URL 一旦发出去，路径就由这里决定；路径里混进 `..` 或反斜杠
 * 会让文件落到 jobs/<id>/ 之外。所以前端和 API 各调一次同一份实现，
 * 并且能被单测直接锁死（__tests__/real-bank-ingest-validate.test.js）。
 */

const { encodeObjectPath } = require("./objectKey.mjs");

const MAX_SET_NAME = 60;
const MAX_FILES = 200;
const MAX_FILE_BYTES = 50 * 1024 * 1024; // Supabase 免费档单对象上限
const MAX_TOTAL_BYTES = 400 * 1024 * 1024;
const SOURCE_KINDS = ["auto", "first_pdf", "vendor_docx", "screenshot_docx"];
const JOB_KINDS = ["ingest", "rebuild"];

// 套名白名单：中英文数字 + . _ - 空格 + 全角/半角括号。不允许 / \ 等路径字符。
const SET_NAME_RE = /^[\p{L}\p{N}._\-（）() ]+$/u;
// jobId 只可能是我们自己生成的 uuid；拼路径前再确认一次。
const UUID_RE = /^[0-9a-fA-F-]{8,64}$/;

/** 控制字符会让 Storage 的对象 key 变形，逐码点挡掉（比控制字符正则更好读）。 */
function hasControlChar(s) {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

function isSafeRelPath(p) {
  const s = String(p || "");
  if (!s || s.length > 400) return false;
  if (s.includes("\\")) return false;
  if (s.startsWith("/")) return false;
  if (s.includes("//")) return false;
  if (hasControlChar(s)) return false;
  if (s.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return false;
  return true;
}

/** @returns {{ok:true,value:string}|{ok:false,error:string}} */
function validateSetName(raw) {
  const name = String(raw || "").trim();
  if (!name) return { ok: false, error: "套名不能为空" };
  if (name.length > MAX_SET_NAME) return { ok: false, error: `套名过长（>${MAX_SET_NAME} 字）` };
  if (!SET_NAME_RE.test(name)) return { ok: false, error: "套名含非法字符（只允许中英文数字、空格、. _ - 和括号）" };
  return { ok: true, value: name };
}

function validateSourceKind(raw, { allowEmpty = true } = {}) {
  const v = String(raw || "").trim();
  if (!v) {
    if (allowEmpty) return { ok: true, value: "auto" };
    return { ok: false, error: "缺少 source_kind" };
  }
  if (!SOURCE_KINDS.includes(v)) return { ok: false, error: `未知的源格式：${v}` };
  return { ok: true, value: v };
}

/**
 * 校验待上传文件清单。
 * @param {Array<{path:string,size:number}>} raw
 * @returns {{ok:true,value:Array<{path:string,size:number,uploaded:boolean}>}|{ok:false,error:string}}
 */
function validateFiles(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "没有要上传的文件" };
  if (raw.length > MAX_FILES) return { ok: false, error: `文件太多（${raw.length} 个，上限 ${MAX_FILES}）` };
  const seen = new Set();
  const out = [];
  let total = 0;
  for (const f of raw) {
    const p = String((f && f.path) || "").trim();
    if (!isSafeRelPath(p)) return { ok: false, error: `非法文件路径：${p || "(空)"}` };
    if (seen.has(p)) return { ok: false, error: `文件路径重复：${p}` };
    seen.add(p);
    const size = Number(f && f.size);
    if (!Number.isFinite(size) || size < 0) return { ok: false, error: `文件大小无效：${p}` };
    if (size > MAX_FILE_BYTES) {
      return { ok: false, error: `单文件超过 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB：${p}` };
    }
    total += size;
    out.push({ path: p, size, uploaded: false });
  }
  if (total > MAX_TOTAL_BYTES) {
    return {
      ok: false,
      error: `总量超过 ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)}MB（当前 ${Math.round(total / 1024 / 1024)}MB）`,
    };
  }
  return { ok: true, value: out };
}

/** 组合校验：POST /jobs 的 body。 */
function validateCreateJob(body = {}) {
  const kind = String(body.kind || "ingest");
  if (!JOB_KINDS.includes(kind)) return { ok: false, error: `未知的 job kind：${kind}` };

  const name = validateSetName(body.set_name);
  if (!name.ok) return name;
  const sk = validateSourceKind(body.source_kind);
  if (!sk.ok) return sk;

  if (kind === "rebuild") {
    return { ok: true, value: { kind, set_name: name.value, source_kind: sk.value, files: [] } };
  }
  const files = validateFiles(body.files);
  if (!files.ok) return files;
  return { ok: true, value: { kind, set_name: name.value, source_kind: sk.value, files: files.value } };
}

/**
 * 拼 job 的**逻辑**路径（`jobs/<id>/<原始相对路径>`），任何一段不干净就抛
 * （绝不返回一个「差不多」的路径）。这是给人看 / 对账用的口径，**不是**桶里的 key。
 */
function jobObjectPath(jobId, relPath) {
  const id = String(jobId || "").trim();
  if (!UUID_RE.test(id)) throw new Error(`非法 jobId：${jobId}`);
  if (!isSafeRelPath(relPath)) throw new Error(`非法文件路径：${relPath}`);
  return `jobs/${id}/${relPath}`;
}

/**
 * 拼真正写进 Storage 的对象 key：逻辑路径逐段过 objectKey.mjs 编码。
 * Supabase 的 isValidKey 不收中文/空格，桶里只能存编码形态（见 objectKey.mjs 文件头）。
 */
function jobObjectKey(jobId, relPath) {
  return encodeObjectPath(jobObjectPath(jobId, relPath));
}

function jobDirPath(jobId) {
  const id = String(jobId || "").trim();
  if (!UUID_RE.test(id)) throw new Error(`非法 jobId：${jobId}`);
  return `jobs/${id}`;
}

module.exports = {
  MAX_SET_NAME,
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  SOURCE_KINDS,
  JOB_KINDS,
  hasControlChar,
  isSafeRelPath,
  validateSetName,
  validateSourceKind,
  validateFiles,
  validateCreateJob,
  jobObjectPath,
  jobObjectKey,
  jobDirPath,
};
