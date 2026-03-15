/**
 * 共享 API 错误响应工具。消除各路由文件里重复的 jsonError() 定义。
 *
 * ── 用法 ──────────────────────────────────────────────────
 *
 *   import { jsonError } from "@/lib/apiResponse";
 *
 *   // 在 API route handler 里：
 *   return jsonError(400, "Missing userCode");
 *   return jsonError(429, "Too many requests");
 *   return jsonError(500, e.message || "Unexpected error");
 *
 *   // 响应体格式：{ "error": "Missing userCode" }
 *
 * ── 注意 ──────────────────────────────────────────────────
 *
 *   - verify-code 路由没用这个（它返回 { valid: false, error }，格式不同）
 *   - IAP 路由没用这个（它们用 lib/iap/errors.js 里的 iapJsonError）
 */

/**
 * @param {number} status - HTTP 状态码
 * @param {string} error  - 错误信息
 */
export function jsonError(status, error) {
  return Response.json({ error }, { status });
}
