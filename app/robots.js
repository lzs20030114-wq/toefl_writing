/**
 * Next.js robots.txt — 告诉搜索引擎哪些页面可以爬、哪些不行。
 *
 * ── 工作原理 ──────────────────────────────────────────────
 *
 *   放在 app/robots.js 就自动生效，访问 /robots.txt 会返回纯文本。
 *   admin 页面和 API 路由被禁止爬取（不希望被搜索引擎收录）。
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://treepractice.com";

export default function robots() {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/admin-*", "/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
