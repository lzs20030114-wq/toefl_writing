export class IapError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = "IapError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function toIapError(err) {
  if (err instanceof IapError) return err;
  return new IapError("IAP_UNEXPECTED_ERROR", err?.message || "Unexpected IAP error", 500);
}

/**
 * IAP 路由共享的 JSON 错误响应。把 IapError 转成标准格式。
 *
 * 用法：
 *   import { iapJsonError } from "@/lib/iap/errors";
 *   return iapJsonError(e);
 *
 * 响应体格式：{ ok: false, error: "IAP_XXX", message: "...", details: ... }
 */
export function iapJsonError(error) {
  const e = error instanceof IapError ? error : toIapError(error);
  return Response.json(
    { ok: false, error: e.code, message: e.message, details: e.details || null },
    { status: e.status || 500 },
  );
}

