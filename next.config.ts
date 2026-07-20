import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.75"],
  typescript: {
    ignoreBuildErrors: true,
  },
  serverExternalPackages: ["mammoth", "docx", "@xenova/transformers", "onnxruntime-node", "sharp"],
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
