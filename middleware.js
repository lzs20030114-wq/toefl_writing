import { NextResponse } from "next/server";

/**
 * 安全响应头 middleware。
 *
 * ── 每个 header 的作用 ───────────────────────────────────
 *
 *   X-Content-Type-Options: nosniff    阻止浏览器猜测 MIME 类型（防 XSS）
 *   X-Frame-Options: DENY              禁止被嵌入 iframe（防点击劫持）
 *   Referrer-Policy                     控制跳转时发送的来源信息
 *   X-DNS-Prefetch-Control: on         允许 DNS 预解析，加速外部资源加载
 *   Permissions-Policy                  禁用不需要的浏览器功能（摄像头、麦克风等）
 *   Strict-Transport-Security           强制 HTTPS（includeSubDomains, 1年）
 */
export function middleware(request) {
  const response = NextResponse.next();
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-DNS-Prefetch-Control", "on");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return response;
}

export const config = {
  // 只对页面和 API 生效，跳过静态资源
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
