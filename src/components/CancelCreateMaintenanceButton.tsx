"use client";

import { useState } from "react";
import { 取消创建保养单 } from "@/app/vehicles/actions";
import { useConfirm } from "./ConfirmDialog";

interface Props {
  orderId: string;
}

export function CancelCreateMaintenanceButton({ orderId }: Props) {
  const [处理中, 设置处理中] = useState(false);
  const { 请求确认, 确认弹窗 } = useConfirm();

  async function 取消创建() {
    if (!(await 请求确认("确定要取消创建吗？该保养单将被删除，不会保留。"))) return;
    设置处理中(true);
    try {
      /* 写库走 Server Action：删除保养单草稿（需求/项目/配件随外键级联删除） */
      const result = await 取消创建保养单(orderId);

      if (!result.success) {
        alert("取消失败: " + (result.error || "未知错误"));
        设置处理中(false);
        return;
      }

      // 刷新原窗口后关闭本窗口
      if (window.opener) {
        window.opener.location.reload();
      }
      window.close();
    } catch (err: unknown) {
      alert("取消失败: " + (err instanceof Error ? err.message : String(err)));
      设置处理中(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={取消创建}
        disabled={处理中}
        className="px-3 py-1.5 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
      >
        {处理中 ? "处理中..." : "取消创建"}
      </button>
      {确认弹窗}
    </>
  );
}
