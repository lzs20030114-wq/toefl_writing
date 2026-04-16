import { NextResponse } from "next/server";

/**
 * 安全响应头 middleware。
 *
 * ── 每个 header 的作用 ───────────────────────────────────
 *
 *   Content-Security-Policy             限制可执行脚本/样式/连接来源（防 XSS 注入）
 *   X-Content-Type-Options: nosniff    阻止浏览器猜测 MIME 类型（防 XSS）
 *   X-Frame-Options: DENY              禁止被嵌入 iframe（防点击劫持）
 *   Referrer-Policy                     控制跳转时发送的来源信息
 *   X-DNS-Prefetch-Control: on         允许 DNS 预解析，加速外部资源加载
 *   Permissions-Policy                  禁用不需要的浏览器功能（摄像头、麦克风等）
 *   Strict-Transport-Security           强制 HTTPS（includeSubDomains, 1年）
 *   Cross-Origin-Opener-Policy          防止跨源弹窗获取 window.opener
 */

/**
 * Content-Security-Policy 指令：
 *   default-src 'self'          — 默认只允许同源资源
 *   script-src 'self' 'unsafe-inline' 'unsafe-eval' — Next.js 需要 inline script + eval (dev hot reload)
 *   style-src 'self' 'unsafe-inline'  — 内联样式 (项目用 style={} 对象)
 *   img-src 'self' data: blob:        — 图片：同源 + data URI + blob (QR code)
 *   font-src 'self' fonts.gstatic.com — 字体：同源 + Google Fonts CDN
 *   connect-src 'self' ...            — API 连接白名单
 *   media-src 'self' blob:            — 音频播放 (TTS + listening)
 *   frame-ancestors 'none'            — 等同 X-Frame-Options: DENY
 *   base-uri 'self'                   — 防止 <base> 标签劫持
 *   form-action 'self'                — 表单只能提交到同源
 */
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' https://*.supabase.co https://api.deepseek.com https://xorpay.com https://afdian.com https://ifdian.net",
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export function middleware(request) {
  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", CSP_DIRECTIVES);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-DNS-Prefetch-Control", "on");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  return response;
}

export const config = {
  // 只对页面和 API 生效，跳过静态资源
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
