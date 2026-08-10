"use client";

/** 打印按钮：调浏览器打印（打印时侧边导航自动隐藏，见 Navbar 的 print:hidden） */
export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700"
    >
      打印
    </button>
  );
}
