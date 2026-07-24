"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient, 确保有session } from "@/lib/supabase/client";
import { 标记本机操作 } from "@/lib/localEditSignal";
import { 保养单草稿前缀, 生成保养单号 } from "@/lib/maintenance";

interface Props {
  orderId: string;
  label?: string;
}

export function SaveMaintenanceButton({ orderId, label }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const [保存中, 设置保存中] = useState(false);
  // 创建模式：保存后关闭窗口并刷新原窗口
  const 创建模式 = searchParams.get("creating") === "1";

  async function 保存() {
    设置保存中(true);
    try {
      await 确保有session();
      标记本机操作();

      if (创建模式) {
        // 保存时才生成正式 BY- 单号，替换 DRAFT- 草稿单号
        const today = new Date();
        const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
        const { count } = await supabase
          .from("work_orders")
          .select("id", { count: "exact", head: true })
          .eq("order_type", "maintenance")
          .not("order_no", "like", 保养单草稿前缀 + "%")
          .gte("created_at", today.toISOString().slice(0, 10));
        const 单号 = 生成保养单号(dateStr, count || 0);

        const { error: 单号错误 } = await supabase
          .from("work_orders")
          .update({ order_no: 单号, updated_at: new Date().toISOString() })
          .eq("id", orderId);

        if (单号错误) {
          alert("保存失败: " + 单号错误.message);
          设置保存中(false);
          return;
        }

        // 刷新原窗口（在修工单）后关闭本窗口
        if (window.opener) {
          window.opener.location.reload();
        }
        window.close();
        return;
      }

      // 普通编辑场景：数据在编辑过程中已实时保存，这里只更新时间戳表示确认保存
      const { error } = await supabase
        .from("work_orders")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", orderId);

      if (error) {
        alert("保存失败: " + error.message);
        设置保存中(false);
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
