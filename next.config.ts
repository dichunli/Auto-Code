import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.75"],
  /* 2026-08-06：移除 typescript.ignoreBuildErrors（原值为 true，类型错误全部放行）。
   * 类型安检门已重新打开——构建时类型错误会直接失败，必须在提交前修掉 */
  serverExternalPackages: ["mammoth", "docx", "@xenova/transformers", "onnxruntime-node", "sharp", "ffmpeg-static"],
  experimental: {
    serverActions: {
      bodySizeLimit: "2gb",
    },
    proxyClientMaxBodySize: 2 * 1024 * 1024 * 1024, /* 2GB */
  },
  async headers() {
    return [
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
      /* 防止浏览器缓存Next.js静态JS，避免Server Action ID不匹配 */
      {
        source: "/_next/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate, max-age=0",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
