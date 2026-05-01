"use client";

import { useEffect } from "react";
import Link from "next/link";

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
      <div className="text-2xl font-bold text-gray-900 mb-4">加载工单失败</div>
      <p className="text-gray-600 mb-6">{error.message || "请稍后重试"}</p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          重试
        </button>
        <Link
          href="/work-orders"
          className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          返回工单列表
        </Link>
      </div>
    </div>
  );
}
