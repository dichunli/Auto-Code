import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* 开发环境局域网调试来源（手机/其他电脑访问 dev 服务器用）。
   * 注意：换网络环境（IP 变了）记得改这里，否则局域网访问 dev 会被拦 */
  allowedDevOrigins: ["192.168.1.75"],
  /* 2026-08-06：移除 typescript.ignoreBuildErrors（原值为 true，类型错误全部放行）。
   * 类型安检门已重新打开——构建时类型错误会直接失败，必须在提交前修掉 */
  serverExternalPackages: ["mammoth", "docx", "@xenova/transformers", "onnxruntime-node", "sharp", "ffmpeg-static"],
  experimental: {
    serverActions: {
      /* 2026-08-29 待办#15：2gb → 200mb。Server Action 只走 JSON 表单，
       * 视频/大文件走 /api/upload 裸流（不受此限制），业务上限远低于 200MB */
      bodySizeLimit: "200mb",
    },
    /* 保持 2GB：/api/upload 的视频上传（上限 500MB）经过代理层，不能小于它 */
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
