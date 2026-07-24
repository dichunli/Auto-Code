"use client";

import { useState } from "react";
import { createClient, 确保有session } from "@/lib/supabase/client";

interface Props {
  orderId: string;
}

export function CancelCreateMaintenanceButton({ orderId }: Props) {
  const supabase = createClient();
  const [处理中, 设置处理中] = useState(false);

  async function 取消创建() {
    if (!confirm("确定要取消创建吗？该保养单将被删除，不会保留。")) return;
    设置处理中(true);
    try {
      await 确保有session();
      // 删除保养单（需求/项目/配件随外键级联删除）
      const { error } = await supabase
        .from("work_orders")
        .delete()
        .eq("id", orderId);

      if (error) {
        alert("取消失败: " + error.message);
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
    <button
      type="button"
      onClick={取消创建}
      disabled={处理中}
      className="px-3 py-1.5 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
    >
      {处理中 ? "处理中..." : "取消创建"}
    </button>
  );
}
