"use client";

/* 抖音视频链接判断与渲染组件 */

const 抖音域名列表 = [
  "douyin.com",
  "iesdouyin.com",
  "v.douyin.com",
  "www.douyin.com",
  "m.douyin.com",
];

export function 是抖音链接(url: string): boolean {
  try {
    const 主机名 = new URL(url).hostname.toLowerCase();
    return 抖音域名列表.some((域名) =>
      主机名 === 域名 || 主机名.endsWith(`.${域名}`)
    );
  } catch {
    return false;
  }
}

/* 从抖音链接中尝试提取视频ID（用于显示） */
export function 提取抖音视频ID(url: string): string | null {
  try {
    const urlObj = new URL(url);
    /* 长链接格式: /video/xxxxx */
    const 匹配 = urlObj.pathname.match(/\/video\/(\d+)/);
    if (匹配) return 匹配[1];
    /* 短链接无法直接提取ID */
    return null;
  } catch {
    return null;
  }
}

interface 抖音视频卡片属性 {
  url: string;
  caption?: string;
}

export function 抖音视频卡片({ url, caption }: 抖音视频卡片属性) {
  const 视频ID = 提取抖音视频ID(url);

  return (
    <figure className="my-4">
      <div className="max-w-2xl mx-auto rounded-xl border border-gray-200 overflow-hidden bg-white">
        {/* 顶部：抖音标识 */}
        <div className="flex items-center gap-2 px-4 py-3 bg-gray-900">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
            <path
              d="M12.53 2C12.53 2 12.53 6.5 12.53 8C12.53 10.5 14.53 12.5 17.03 12.5C17.83 12.5 18.53 12.3 19.03 12V16.5C19.03 16.5 17.53 17 16.03 17C13.53 17 11.53 15 11.53 12.5V8H8.53V12.5C8.53 16.5 11.53 19.5 15.53 19.5C16.53 19.5 17.53 19.3 18.53 18.8V22C18.53 22 17.03 22.5 15.53 22.5C10.53 22.5 6.53 18.5 6.53 13.5V8H4.53V4H11.53C11.53 3 12.03 2 12.53 2Z"
              fill="white"
            />
          </svg>
          <span className="text-white text-sm font-medium">抖音视频</span>
          {视频ID && (
            <span className="text-gray-400 text-xs ml-auto">ID: {视频ID}</span>
          )}
        </div>

        {/* 中间：播放区域 */}
        <div className="aspect-video bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center relative">
          {/* 背景装饰 */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-1/4 left-1/4 w-32 h-32 rounded-full bg-white/20" />
            <div className="absolute bottom-1/3 right-1/4 w-24 h-24 rounded-full bg-white/10" />
          </div>

          {/* 播放按钮 */}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="relative z-10 flex flex-col items-center gap-3 group"
          >
            <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center group-hover:bg-white/30 transition-colors backdrop-blur-sm">
              <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <span className="text-white/80 text-sm group-hover:text-white transition-colors">
              点击在抖音观看
            </span>
          </a>
        </div>

        {/* 底部：链接信息 */}
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-500 hover:text-blue-600 break-all line-clamp-1 transition-colors"
          >
            {url}
          </a>
        </div>
      </div>

      {caption && (
        <figcaption className="text-center text-sm text-gray-500 mt-2">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

/* 简化版抖音卡片（用于知识库/课程页等非编辑器场景） */
export function 抖音视频简化卡片({ url }: { url: string }) {
  return (
    <div className="mb-4 aspect-video bg-gray-900 rounded-lg flex flex-col items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-1/4 left-1/4 w-32 h-32 rounded-full bg-white/20" />
        <div className="absolute bottom-1/3 right-1/4 w-24 h-24 rounded-full bg-white/10" />
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="relative z-10 flex flex-col items-center gap-2 group"
      >
        <div className="flex items-center gap-2">
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
            <path
              d="M12.53 2C12.53 2 12.53 6.5 12.53 8C12.53 10.5 14.53 12.5 17.03 12.5C17.83 12.5 18.53 12.3 19.03 12V16.5C19.03 16.5 17.53 17 16.03 17C13.53 17 11.53 15 11.53 12.5V8H8.53V12.5C8.53 16.5 11.53 19.5 15.53 19.5C16.53 19.5 17.53 19.3 18.53 18.8V22C18.53 22 17.03 22.5 15.53 22.5C10.53 22.5 6.53 18.5 6.53 13.5V8H4.53V4H11.53C11.53 3 12.03 2 12.53 2Z"
              fill="white"
            />
          </svg>
          <span className="text-white text-sm font-medium">抖音视频</span>
        </div>
        <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center group-hover:bg-white/30 transition-colors">
          <svg className="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
        <span className="text-white/70 text-xs group-hover:text-white transition-colors">
          点击在抖音观看
        </span>
      </a>
    </div>
  );
}
