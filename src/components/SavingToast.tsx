"use client";

import { useEffect, useState } from "react";

/* 保存成功即时反馈提示条：
 * 监听"wo-saved-pending"事件，在页面顶部显示绿色提示，
 * 让用户立刻知道"已存上了，内容正在加载"，不用对着旧页面怀疑。
 * 8 秒后自动消失（覆盖整页刷新的加载时间）。 */
export default function SavingToast() {
  const [提示, 设置提示] = useState<string | null>(null);

  useEffect(() => {
    let 定时器: ReturnType<typeof setTimeout> | null = null;
    function handle(e: Event) {
      const detail = (e as CustomEvent).detail as { message: string };
      设置提示(detail.message);
      if (定时器) clearTimeout(定时器);
      定时器 = setTimeout(() => 设置提示(null), 8000);
    }
    window.addEventListener("wo-saved-pending", handle as EventListener);
    return () => {
      window.removeEventListener("wo-saved-pending", handle as EventListener);
      if (定时器) clearTimeout(定时器);
    };
  }, []);

  if (!提示) return null;

  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[200] px-1">
      <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-green-500 text-white text-sm font-medium shadow-lg">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        {提示}
      </div>
    </div>
  );
}
