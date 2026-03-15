/**
 * Next.js 动态 sitemap — 自动生成 /sitemap.xml 供搜索引擎爬取。
 *
 * ── 工作原理 ──────────────────────────────────────────────
 *
 *   放在 app/sitemap.js 就自动生效，访问 /sitemap.xml 会返回 XML。
 *   搜索引擎（Google、百度）会定期来读这个文件，知道你有哪些页面。
 *
 * ── 怎么加新页面 ─────────────────────────────────────────
 *
 *   在下面的 routes 数组里加一项 { path, priority, changeFreq }
 *   priority: 0.0-1.0，1.0 = 最重要
 *   changeFrequency: always / hourly / daily / weekly / monthly / yearly / never
 *
 * ── 验证方法 ──────────────────────────────────────────────
 *
 *   启动 dev 后访问 http://localhost:3000/sitemap.xml
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://treepractice.com";

const routes = [
  { path: "/",                  priority: 1.0, changeFrequency: "weekly" },
  { path: "/academic-writing",  priority: 0.9, changeFrequency: "weekly" },
  { path: "/email-writing",     priority: 0.9, changeFrequency: "weekly" },
  { path: "/build-sentence",    priority: 0.9, changeFrequency: "weekly" },
  { path: "/mock-exam",         priority: 0.8, changeFrequency: "weekly" },
  { path: "/progress",          priority: 0.5, changeFrequency: "daily" },
  { path: "/terms",             priority: 0.2, changeFrequency: "yearly" },
];

export default function sitemap() {
  return routes.map(({ path, priority, changeFrequency }) => ({
    url: `${SITE_URL}${path}`,
    lastModified: new Date(),
    changeFrequency,
    priority,
  }));
}
