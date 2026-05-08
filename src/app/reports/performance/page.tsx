import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";

export default async function PerformanceReportPage() {
  const supabase = await createClient();

  const { data: mechanics } = await supabase
    .from("profiles")
    .select("id, full_name, mechanic_levels(name, share_coefficient)")
    .eq("is_active", true);

  // 从 work_order_item_mechanics 统计多人施工的分配业绩
  const { data: mechanicCommissions } = await supabase
    .from("work_order_item_mechanics")
    .select("mechanic_id, share_pct, work_order_items(total_price, status)")
    .eq("work_order_items.status", "completed");

  // 施工工时统计（从 construction_logs）
  const { data: constructionLogs } = await supabase
    .from("work_order_item_construction_logs")
    .select("mechanic_id, duration_seconds, action")
    .eq("action", "complete");

  const mechanicStats: Record<string, {
    name: string;
    level: string;
    levelCoeff: number;
    itemCount: number;
    totalValue: number;
    totalHours: number;
    workOrderCount: number;
    woSet: Set<string>;
  }> = {};

  mechanics?.forEach((m: any) => {
    mechanicStats[m.id] = {
      name: m.full_name,
      level: m.mechanic_levels?.name || "",
      levelCoeff: m.mechanic_levels?.share_coefficient || 1,
      itemCount: 0,
      totalValue: 0,
      totalHours: 0,
      workOrderCount: 0,
      woSet: new Set(),
    };
  });

  // 按 share_pct 计算业绩
  (mechanicCommissions || []).forEach((row: any) => {
    const stats = mechanicStats[row.mechanic_id];
    if (stats && row.work_order_items) {
      const price = row.work_order_items.total_price || 0;
      const ratio = (row.share_pct || 100) / 100;
      stats.itemCount += 1;
      stats.totalValue += price * ratio;
    }
  });

  // 统计参与过的工单数
  const { data: woItems } = await supabase
    .from("work_order_items")
    .select("id, work_order_id, mechanic_id");

  // 通过 work_order_item_mechanics 统计参与工单
  const { data: mechanicWos } = await supabase
    .from("work_order_item_mechanics")
    .select("mechanic_id, work_order_item_id(work_order_id)");

  (mechanicWos || []).forEach((row: any) => {
    const stats = mechanicStats[row.mechanic_id];
    if (stats && row.work_order_item_id?.work_order_id) {
      stats.woSet.add(row.work_order_item_id.work_order_id);
    }
  });

  // 单人施工的工单（兼容旧数据）
  (woItems || []).forEach((item: any) => {
    if (item.mechanic_id) {
      const stats = mechanicStats[item.mechanic_id];
      if (stats) {
        stats.woSet.add(item.work_order_id);
      }
    }
  });

  // 工时统计
  (constructionLogs || []).forEach((log: any) => {
    const stats = mechanicStats[log.mechanic_id];
    if (stats) {
      stats.totalHours += (log.duration_seconds || 0) / 3600;
    }
  });

  Object.values(mechanicStats).forEach((s) => {
    s.workOrderCount = s.woSet.size;
  });

  return (
    <div className="space-y-6">
      <PageHeader title="员工业绩" description="技师工单数、项目金额与工时统计（支持多人施工提成分配）" />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">员工</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">等级</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">等级系数</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">参与工单</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">完成项目</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">分配业绩</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">总工时</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">平均工时/项目</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {Object.entries(mechanicStats)
                .sort((a, b) => b[1].totalValue - a[1].totalValue)
                .map(([id, s]) => (
                  <tr key={id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">{s.name}</td>
                    <td className="px-6 py-4 text-gray-600">{s.level || "-"}</td>
                    <td className="px-6 py-4 text-gray-600">{s.levelCoeff}</td>
                    <td className="px-6 py-4 text-gray-600">{s.workOrderCount}</td>
                    <td className="px-6 py-4 text-gray-600">{s.itemCount}</td>
                    <td className="px-6 py-4 font-medium text-gray-900">{formatCurrency(s.totalValue)}</td>
                    <td className="px-6 py-4 text-gray-600">{s.totalHours.toFixed(1)}h</td>
                    <td className="px-6 py-4 text-gray-600">
                      {s.itemCount > 0 ? (s.totalHours / s.itemCount).toFixed(1) : "0"}h
                    </td>
                  </tr>
                ))}
              {mechanics?.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-400">
                    暂无员工数据
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
