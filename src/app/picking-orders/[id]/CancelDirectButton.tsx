"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { 取消直领 } from "@/app/picking-orders/actions";

/* 取消直领按钮（领料单详情页，仅未冲账的直领行显示）：
   删登记即可（本就无库存影响）；已冲账的走退料流程 */
export function CancelDirectButton({ 领料记录id }: { 领料记录id: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const { 请求确认, 确认弹窗 } = useConfirm();
  const [loading, setLoading] = useState(false);

  async function 处理() {
    if (!(await 请求确认("取消这笔急件直领？领料记录会被删除（配件视为未领）"))) return;
    setLoading(true);
    try {
      const r = await 取消直领(领料记录id);
      if (!r.success) {
        showToast("取消直领失败: " + (r.error || "未知错误"), "error");
        return;
      }
      showToast("已取消直领", "success");
      router.refresh();
    } catch (err: unknown) {
      showToast("取消直领失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={处理}
        disabled={loading}
        className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
      >
        {loading ? "处理中..." : "取消直领"}
      </button>
      {确认弹窗}
    </>
  );
}
