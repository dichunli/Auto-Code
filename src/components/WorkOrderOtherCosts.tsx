"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { 删除工单其它成本 } from "@/app/work-orders/actions";
import { useConfirm } from "./ConfirmDialog";
import { useToast } from "./Toast";

/* 工单其它成本明细（2026-09-18 用户拍板：明细列表形式）
 * 展示退货运费分摊等成本条目（名称/金额/来源/时间），误记可删。
 * 注意：与"其他费用"（other_cost，向客户收的费）是两回事，这是内部成本。 */
export interface 其它成本行 {
  id: string;
  name: string;
  amount: number;
  source: string;
  reference_id: string | null;
  notes: string | null;
  created_at: string;
}

const 来源标签: Record<string, string> = {
  return_freight: "退货运费分摊",
  manual: "手工补记",
};

export function WorkOrderOtherCosts({
  costs,
  orderId,
}: {
  costs: 其它成本行[];
  orderId: string;
}) {
  const router = useRouter();
  const { 请求确认, 确认弹窗 } = useConfirm();
  const { showToast } = useToast();
  const [删除中, set删除中] = useState<string | null>(null);

  async function 删除(行: 其它成本行) {
    if (!(await 请求确认(`确定删除这条其它成本「${行.name} ${formatCurrency(行.amount)}」吗？`))) return;
    set删除中(行.id);
    try {
      const res = await 删除工单其它成本(行.id, orderId);
      if (!res.success) {
        showToast("删除失败: " + (res.error || "未知错误"), "error");
        return;
      }
      showToast("已删除", "success");
      router.refresh();
    } catch (err: unknown) {
      showToast("删除失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    } finally {
      set删除中(null);
    }
  }

  const 合计 = costs.reduce((sum, c) => sum + (c.amount || 0), 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-base font-semibold text-gray-900 mb-1">其它成本</h2>
      <p className="text-xs text-gray-400 mb-4">内部成本（退货运费分摊等），不向客户收取</p>
      <div className="space-y-2">
        {costs.map((c) => (
          <div key={c.id} className="flex items-center justify-between text-sm">
            <div className="text-gray-600">
              <span>{c.name}</span>
              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                {来源标签[c.source] || c.source}
              </span>
              {c.notes && <span className="ml-2 text-xs text-gray-400">{c.notes}</span>}
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-red-600">{formatCurrency(c.amount)}</span>
              <button
                type="button"
                onClick={() => 删除(c)}
                disabled={删除中 === c.id}
                className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
              >
                {删除中 === c.id ? "删除中..." : "删除"}
              </button>
            </div>
          </div>
        ))}
        <div className="border-t border-gray-100 pt-2 flex justify-between text-sm font-medium text-gray-900">
          <span>其它成本合计</span>
          <span className="text-red-600">{formatCurrency(合计)}</span>
        </div>
      </div>
      {确认弹窗}
    </div>
  );
}
