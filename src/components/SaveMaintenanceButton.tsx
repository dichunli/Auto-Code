"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { 保存保养单 } from "@/app/vehicles/actions";
import { 标记本机操作 } from "@/lib/localEditSignal";

interface Props {
  orderId: string;
  label?: string;
}

export function SaveMaintenanceButton({ orderId, label }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [保存中, 设置保存中] = useState(false);
  // 创建模式：保存后关闭窗口并刷新原窗口
  const 创建模式 = searchParams.get("creating") === "1";

  async function 保存() {
    设置保存中(true);
    try {
      标记本机操作();

      /* 写库走 Server Action：
       * 创建模式在服务端生成正式 BY- 单号替换 DRAFT- 草稿单号；
       * 普通编辑场景数据已实时保存，服务端只更新时间戳表示确认保存 */
      const result = await 保存保养单({ orderId, 创建模式 });
      if (!result.success) {
        alert("保存失败: " + (result.error || "未知错误"));
        设置保存中(false);
        return;
      }

      if (创建模式) {
        // 刷新原窗口（在修工单）后关闭本窗口
        if (window.opener) {
          window.opener.location.reload();
        }
        window.close();
        return;
      }

      // 返回只读模式
      const fromWorkOrder = searchParams.get("from_work_order");
      if (fromWorkOrder) {
        router.push(`/work-orders/${orderId}?from_work_order=${fromWorkOrder}`);
      } else {
        router.push(`/work-orders/${orderId}`);
      }
    } catch (err: unknown) {
      alert("保存失败: " + (err instanceof Error ? err.message : String(err)));
      设置保存中(false);
    }
  }

  return (
    <button
      type="button"
      onClick={保存}
      disabled={保存中}
      className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
    >
      {保存中 ? "保存中..." : label || "保存并退出编辑"}
    </button>
  );
}
