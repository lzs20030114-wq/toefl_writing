/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    outputFileTracingIncludes: {
      "/api/admin/questions": ["./data/**/*"],
      "/api/admin/generate-bs": ["./data/**/*", "./scripts/**/*"],
    },
  },
};
module.exports = nextConfig;
