/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // 隐藏 X-Powered-By: Next.js（减少信息泄露）
  compress: true,
  experimental: {
    outputFileTracingIncludes: {
      "/api/admin/questions": ["./data/**/*"],
      "/api/admin/generate-bs": ["./data/**/*", "./scripts/**/*"],
    },
  },
};
module.exports = nextConfig;
