"use client";

import { useState } from "react";
import { 完整退出登录 } from "@/lib/logout";
import { useRouter } from "next/navigation";

export function MobileLogoutButton() {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);

  async function handleLogout() {
    /* 完整退出登录（2026-09-01）：本地清除+服务端后台作废 Token，见 src/lib/logout.ts */
    await 完整退出登录();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowConfirm(true)}
        className="w-full py-3 text-sm text-red-600 bg-white border border-red-200 rounded-xl hover:bg-red-50 active:bg-red-100 transition-colors"
      >
        退出登录
      </button>

      {showConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-sm mx-4">
            <h3 className="text-base font-semibold text-gray-900 mb-2">退出登录</h3>
            <p className="text-sm text-gray-500 mb-6">确定要退出当前账号吗？</p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowConfirm(false);
                  handleLogout();
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
              >
                确定退出
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
