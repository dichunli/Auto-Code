"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <div className="text-2xl font-bold text-gray-900 mb-4">出错了</div>
      <p className="text-gray-600 mb-6">{error.message || "页面加载失败，请稍后重试"}</p>
      <button
        onClick={reset}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        重试
      </button>
    </div>
  );
}
