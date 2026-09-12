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
    outputFileTracingIncludes: {
      "/api/admin/questions": ["./data/**/*"],
      "/api/admin/generate-bs": ["./data/**/*", "./scripts/**/*"],
      // Admin content endpoints need access to bank + staging JSON (but NOT audio).
      "/api/admin/content": [
        "./data/academicWriting/**/*.json",
        "./data/emailWriting/**/*.json",
        "./data/buildSentence/**/*.json",
        "./data/listening/bank/**/*.json",
        "./data/listening/staging/**/*.json",
        "./data/reading/bank/**/*.json",
        "./data/reading/staging/**/*.json",
        "./data/speaking/bank/**/*.json",
        "./data/speaking/staging/**/*.json",
      ],
      "/api/admin/content/staging": [
        "./data/academicWriting/staging/**/*.json",
        "./data/emailWriting/staging/**/*.json",
        "./data/buildSentence/staging/**/*.json",
        "./data/listening/staging/**/*.json",
        "./data/reading/staging/**/*.json",
        "./data/speaking/staging/**/*.json",
      ],
    },
    // Next.js tracer is over-aggressive for functions that use fs.readdirSync:
    // it pulls in .next/cache/webpack (451 MB), .git, and audio blobs. Exclude
    // these explicitly so admin content functions stay under Vercel's 250 MB.
    outputFileTracingExcludes: {
      "/api/admin/content": [
        "./data/listening/audio/**/*",
        "./data/**/*.mp3",
        "./data/**/*.wav",
        "./data/**/*.m4a",
        "./.next/cache/**/*",
        "./.git/**/*",
      ],
      "/api/admin/content/staging": [
        "./data/listening/audio/**/*",
        "./data/**/*.mp3",
        "./data/**/*.wav",
        "./data/**/*.m4a",
        "./.next/cache/**/*",
        "./.git/**/*",
      ],
      "/api/admin/questions": [
        "./data/listening/audio/**/*",
        "./data/**/*.mp3",
        "./data/**/*.wav",
        "./data/**/*.m4a",
        "./.next/cache/**/*",
        "./.git/**/*",
      ],
    },
  },
};
module.exports = nextConfig;
