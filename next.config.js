/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    outputFileTracingIncludes: {
      "/api/admin/questions": ["./data/**/*"],
    },
  },
};
module.exports = nextConfig;
