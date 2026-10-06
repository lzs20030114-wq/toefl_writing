/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // 隐藏 X-Powered-By: Next.js（减少信息泄露）
  compress: true,
  async headers() {
    return [
      {
        // 划词词典的分片是只读静态表（换词库 = 重跑 scripts/dict/build-dict.mjs 再部署），
        // 默认的 max-age=0 会让每次复盘都重新下几百 KB，这里放成一天 + 一周内后台刷新。
        source: "/dict/:file*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
        ],
      },
    ];
  },
  experimental: {
    // ── Serverless 函数打包范围（Vercel Function Storage 直接按这里的产物计费）──
    // `/api/admin` 覆盖后台路由；只为只读题库接口列出实际读取的正式库。
    outputFileTracingIncludes: {
      "/api/admin/content": [
        "./data/academicWriting/prompts.json",
        "./data/emailWriting/prompts.json",
        "./data/buildSentence/questions.json",
        "./data/listening/bank/*.json",
        "./data/reading/bank/*.json",
        "./data/speaking/bank/*.json",
      ],
    },
    // 用 `readdirSync(join(process.cwd(), dir))` 读目录的路由，追踪器会保守地把整个项目根目录拖进函数包
    // （字体 10 MB、截图证据 9 MB、历史备份、测试夹具……），这里把与运行时无关的目录统一排除。
    // 注意 exclude 也是 contains 匹配，所以只写项目里独有的目录名，不写 lib/ src/ 这种 node_modules 里也有的。
    outputFileTracingExcludes: {
      "/api/admin": [
        "./reports/**",
        "./public/**",
        "./docs/**",
        "./research_notes/**",
        "./__tests__/**",
        "./e2e/**",
        "./scripts/**",
        "./.github/**",
        "./.claude/**",
        "./.agents/**",
        "./.codex/**",
        "./.ops/**",
        "./data/newBank/**",
        "./data/claudeGen/**",
        "./data/realBank/**",
        "./data/realExam2026/**",
        "./data/eval-profiles/**",
        "./data/vocabulary/**",
        "./data/reading/samples/**",
        "./data/listening/audio/**",
        "./data/**/*.mp3",
        "./data/**/*.wav",
        "./data/**/*.m4a",
        "./.next/cache/**",
        "./.git/**",
      ],
    },
  },
};
module.exports = nextConfig;
