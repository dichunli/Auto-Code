"use client";

/* 通用打印按钮（客户端组件）
   服务端渲染的单据详情页不能直接在 button 上写 onClick，
   统一用这个组件调浏览器打印 */
export function PrintButton({ label = "打印" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="px-3 py-1.5 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
    >
      {label}
    </button>
  );
}
