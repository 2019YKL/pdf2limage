/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // 在生产构建期间忽略ESLint错误
    ignoreDuringBuilds: true,
  },
  typescript: {
    // 在生产构建期间忽略TypeScript错误
    ignoreBuildErrors: true,
  },
  // 输出选项，使用较小的serverless配置
  output: 'standalone',
  // 优化部署包大小
  experimental: {
    outputFileTracingExcludes: {
      '*': [
        'node_modules/@swc/core-linux-x64-gnu',
        'node_modules/@swc/core-linux-x64-musl',
        'node_modules/@esbuild/linux-x64',
        'public/temp/**'
      ],
    },
  },
  // 禁用图像优化以减少包大小
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
