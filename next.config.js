/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // 隐藏 X-Powered-By: Next.js（减少信息泄露）
  compress: true,
  eslint: {
    // Lint 已在 CI 独立步骤中运行 (npm run lint)，构建时跳过避免重复
    ignoreDuringBuilds: true,
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
    // Audio files are served via /api/audio/[...path]; they should never ship
    // with admin serverless functions (43 MB of mp3 blows past the 250 MB limit).
    outputFileTracingExcludes: {
      "/api/admin/content": ["./data/listening/audio/**/*", "./data/**/*.mp3", "./data/**/*.wav", "./data/**/*.m4a"],
      "/api/admin/content/staging": ["./data/listening/audio/**/*", "./data/**/*.mp3", "./data/**/*.wav", "./data/**/*.m4a"],
      "/api/admin/questions": ["./data/listening/audio/**/*", "./data/**/*.mp3", "./data/**/*.wav", "./data/**/*.m4a"],
    },
  },
};
module.exports = nextConfig;
