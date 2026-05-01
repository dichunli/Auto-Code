import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";

export default async function WorkOrderReportPage() {
  const supabase = await createClient();

  const { data: allOrders } = await supabase
    .from("work_orders")
    .select("status, total_cost");

  const statusCounts: Record<string, number> = {};
  const statusAmounts: Record<string, number> = {};
  let totalAmount = 0;

  allOrders?.forEach((o: any) => {
    statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
    statusAmounts[o.status] = (statusAmounts[o.status] || 0) + (o.total_cost || 0);
    totalAmount += o.total_cost || 0;
  });

  const statusList = [
    { key: "received", label: "已接车" },
    { key: "pending_diagnosis", label: "待诊断" },
    { key: "pending_repair", label: "待维修" },
    { key: "repairing", label: "维修中" },
    { key: "pending_quality_check", label: "待质检" },
    { key: "pending_close", label: "待结单" },
    { key: "pending_settlement", label: "待结算" },
    { key: "settled", label: "已结算" },
    { key: "delivered", label: "已交车" },
  ];

  const totalCount = allOrders?.length || 0;
  const completedCount = (statusCounts["settled"] || 0) + (statusCounts["delivered"] || 0);
  const inProgressCount = totalCount - completedCount;

  return (
    <div className="space-y-6">
      <PageHeader title="工单统计" description="工单数量、状态分布与金额统计" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">总工单数</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{totalCount} 单</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">进行中</div>
          <div className="text-xl font-bold text-blue-600 mt-1">{inProgressCount} 单</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">已完成</div>
          <div className="text-xl font-bold text-green-600 mt-1">{completedCount} 单</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">总金额</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(totalAmount)}</div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">状态分布</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">工单数</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">占比</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">金额</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">金额占比</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {statusList.map((s) => {
                const count = statusCounts[s.key] || 0;
                const amount = statusAmounts[s.key] || 0;
                return (
                  <tr key={s.key} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">{s.label}</td>
                    <td className="px-6 py-4 text-gray-600">{count}</td>
                    <td className="px-6 py-4 text-gray-600">
                      {totalCount > 0 ? ((count / totalCount) * 100).toFixed(1) : 0}%
                    </td>
                    <td className="px-6 py-4 text-gray-900">{formatCurrency(amount)}</td>
                    <td className="px-6 py-4 text-gray-600">
                      {totalAmount > 0 ? ((amount / totalAmount) * 100).toFixed(1) : 0}%
                    </td>
                  </tr>
                );
              })}
              {totalCount === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
                    暂无工单数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
