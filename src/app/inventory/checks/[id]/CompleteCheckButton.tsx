"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { 完成盘点 } from "../../actions";

/* 完成盘点按钮：确认后走事务校准库存（只渲染在待完成的盘点单上） */
export default function CompleteCheckButton({ checkId }: { checkId: string }) {
  const router = useRouter();
  const { 请求确认, 确认弹窗 } = useConfirm();
  const { showToast } = useToast();
  const [提交中, 设置提交中] = useState(false);

  async function 处理完成盘点() {
    if (!(await 请求确认("确定完成盘点吗？将按实盘数校准系统库存并写流水，完成后不可再修改。"))) return;
    设置提交中(true);
    try {
      const result = await 完成盘点(checkId);
      if (!result.success) {
        showToast(result.error || "完成盘点失败", "error");
        return;
      }
      showToast(`盘点完成，校准了 ${result.调整条数 ?? 0} 个配件的库存`, "success");
      router.refresh();
    } catch (err: unknown) {
      showToast("完成盘点失败: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      设置提交中(false);
    }
  }

  return (
    <div className="mt-6 flex justify-end">
      <button
        type="button"
        onClick={处理完成盘点}
        disabled={提交中}
        className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
      >
        {提交中 ? "正在完成..." : "完成盘点（按实盘数校准库存）"}
      </button>
      {确认弹窗}
    </div>
  );
}
