/**
 * Supabase Storage 对象 key 的编码/解码（真题录入两个桶共用）。
 *
 * 为什么非有不可：Supabase storage-api 服务端对 key 有白名单校验，
 * 源码 `src/storage/limits.ts`:
 *
 *   export function isValidKey(key: string): boolean {
 *     return key.length > 0 && /^(\w|\/|!|-|\.|\*|'|\(|\)| |&|\$|@|=|;|:|\+|,|\?)*$/.test(key)
 *   }
 *
 * 也就是只允许 `\w`(=A-Za-z0-9_) 加 `/ ! - . * ' ( ) 空格 & $ @ = ; : + , ?`。
 * 中文、全角括号、以及 percent-encoding 用的 `%` 都**不在**里面 ——
 * 所以 `ocr/1.21新托福真题B卷__新托福2026年真题02.txt` 会被服务端直接 400
 * `Invalid key: …`，percent-encoding 也救不了（`%` 同样非法）。
 *
 * 方案：按 `/` 逐段处理，段内若只含 `[A-Za-z0-9._-]` 就原样保留（绝大多数
 * 目录名 / 英文文件名不变，桶里仍然可读），否则整段换成 `!<base64url(utf8)>`。
 *  - 前缀标记选 `!` 而不是 `~`：`~` 不在上面那个正则里（`\w` 不含 `~`），
 *    `!` 在里面且不可能出现在「原样保留」的段首，所以不歧义。
 *  - base64url 字母表 `A-Za-z0-9-_` 全在合法集内，且不含 `/`（不会凭空多出层级）；
 *    padding `=` 虽然也合法，但一律去掉，保证同一段只有一种编码形态。
 *
 * 约定：桶里只存**编码后**的 key；jobs.files[].path、契约里的 path、
 * 以及落到本地磁盘的路径，一律是**原始相对路径**。转换只发生在这个模块里。
 *
 * 幂等：encode(encode(x)) === encode(x)。判据是「段以 `!` 开头且能解码出一个
 * 重新编码后与自身完全相同的字符串」——这样一个真叫 `!foo` 的文件名不会被误判。
 *
 * ESM(.mjs)：scripts/ 下的 worker/同步脚本是原生 ESM，lib/ 与 app/ 走打包器，
 * 两边都能 import 同一份实现（仓库 package.json 不是 type:module，故用 .mjs 后缀）。
 */

/** 段内这些字符可以原样进 key（都在 isValidKey 白名单内，且不与 base64url 冲突）。 */
const PLAIN_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
/** 编码段的前缀标记。见文件头注释：不能用 `~`。 */
const MARK = "!";
/** 编码段去掉 padding 后的载荷字母表。 */
const B64URL_RE = /^[A-Za-z0-9_-]*$/;

const hasBuffer = typeof Buffer !== "undefined" && typeof Buffer.from === "function";

function toBase64Url(str) {
  if (hasBuffer) return Buffer.from(str, "utf8").toString("base64url");
  // 浏览器兜底：TextEncoder → binary string → btoa → base64url
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64) {
  if (hasBuffer) return Buffer.from(b64, "base64url").toString("utf8");
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** 解码一个已编码段的载荷；不是合法编码段就返回 null。 */
function tryDecodePayload(seg) {
  if (typeof seg !== "string" || seg.length < 2 || seg[0] !== MARK) return null;
  const payload = seg.slice(1);
  if (!B64URL_RE.test(payload)) return null;
  let decoded;
  try {
    decoded = fromBase64Url(payload);
  } catch {
    return null;
  }
  if (!decoded) return null;
  // 解出来的东西不能带路径分隔符 / NUL —— 否则一个精心构造的 key 能凭空多出层级。
  if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) return null;
  // 规范性校验：只有「重新编码后与自身完全一致」才算真的是我们编出来的段。
  // 这条同时挡住了非规范 base64（多余 padding/尾部比特）与真叫 `!xxx` 的文件名。
  if (`${MARK}${toBase64Url(decoded)}` !== seg) return null;
  return decoded;
}

/** 一个段是否已经是编码形态。 */
export function isEncodedSegment(seg) {
  return tryDecodePayload(seg) !== null;
}

/**
 * 单段编码：安全字符原样返回，否则 `!<base64url(utf8)>`。已编码的段原样返回（幂等）。
 * @param {string} seg
 * @returns {string}
 */
export function encodeSegment(seg) {
  const s = String(seg == null ? "" : seg);
  if (s === "") return "";
  if (PLAIN_SEGMENT_RE.test(s)) return s;
  if (isEncodedSegment(s)) return s;
  return MARK + toBase64Url(s);
}

/**
 * 单段解码：编码段还原成原文，其余原样返回。
 * @param {string} seg
 * @returns {string}
 */
export function decodeSegment(seg) {
  const s = String(seg == null ? "" : seg);
  const decoded = tryDecodePayload(s);
  return decoded === null ? s : decoded;
}

/**
 * 逐段编码整条相对路径（保留 `/` 目录结构）。反斜杠先归一成 `/`（Windows 侧扫出来的是反斜杠）。
 * @param {string} relPath 原始相对路径，如 `3.24新托福真题/阅读.pdf`
 * @returns {string} 对象 key，如 `3.24新托福真题` 段被编码后的形态
 */
export function encodeObjectPath(relPath) {
  const p = String(relPath == null ? "" : relPath).replace(/\\/g, "/");
  if (!p) return "";
  return p.split("/").map(encodeSegment).join("/");
}

/**
 * 逐段解码整条对象 key，还原成原始相对路径。
 * @param {string} key
 * @returns {string}
 */
export function decodeObjectPath(key) {
  const p = String(key == null ? "" : key);
  if (!p) return "";
  return p.split("/").map(decodeSegment).join("/");
}
