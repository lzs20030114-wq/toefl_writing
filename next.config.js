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
    // 键用 picomatch `contains` 匹配：`/api/admin/questions` 同时覆盖 `/api/admin/questions/sets/[setId]`，
    // `/api/admin` 覆盖全部后台路由。只给每个路由它真的 readFileSync 的文件；通过 GitHub API 读写题库的
    // 路由（generate-bs / questions/sets）不需要任何本地文件。
    // 2026-10-05 前这里给 questions/generate-bs 塞了 `./data/**/*` + `./scripts/**/*`，
    // 5 个函数各背 55 MB 同一份题库，一次部署函数包合计 464 MB，把 Hobby 10 GB 的额度吃光。
    outputFileTracingIncludes: {
      "/api/admin/questions": [
        "./data/academicWriting/prompts.json",
        "./data/emailWriting/prompts.json",
        "./data/buildSentence/questions.json",
      ],
      "/api/admin/bs-errors": ["./data/buildSentence/questions.json"],
      // 后台内容页：正式库 + staging（contains 匹配，/api/admin/content/staging 也拿到同一份清单；
      // staging 子路由只读 staging 目录，多带的几 MB 正式库可接受，不单独再列一份）。
      "/api/admin/content": [
        "./data/academicWriting/prompts.json",
        "./data/academicWriting/staging/**/*.json",
        "./data/emailWriting/prompts.json",
        "./data/emailWriting/staging/**/*.json",
        "./data/buildSentence/questions.json",
        "./data/buildSentence/staging/**/*.json",
        "./data/listening/bank/*.json",
        "./data/listening/staging/**/*.json",
        "./data/reading/bank/*.json",
        "./data/reading/staging/**/*.json",
        "./data/speaking/bank/*.json",
        "./data/speaking/staging/**/*.json",
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
