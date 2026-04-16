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
    },
  },
};
module.exports = nextConfig;
