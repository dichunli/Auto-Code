import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.75"],
  typescript: {
    ignoreBuildErrors: true,
  },
  serverExternalPackages: ["mammoth", "docx", "@xenova/transformers", "onnxruntime-node", "sharp", "ffmpeg-static"],
  experimental: {
    serverActions: {
      bodySizeLimit: "2gb",
    },
    proxyClientMaxBodySize: 2 * 1024 * 1024 * 1024, /* 2GB */
  },
  async headers() {
    return [
      /* 带内容指纹的静态资源（JS/CSS chunk）：长缓存一年。
       * 文件名随内容变化，新部署自动引用新文件名，天然不存在"旧缓存"问题。
       * 2026-08-07 前全站不缓存，每次访问重新下载全部 JS，首屏慢 */
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      /* 其余全部路径（HTML/RSC 数据）：保持不缓存——
       * 防 Server Action ID 不匹配（部署新版后旧页面按钮点不动的历史问题） */
      {
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate, max-age=0",
          },
          {
            key: "Pragma",
            value: "no-cache",
          },
          {
            key: "Expires",
            value: "0",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
