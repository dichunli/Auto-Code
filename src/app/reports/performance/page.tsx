import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";

interface MechanicStatRow {
  id: string;
  name: string;
  level: string;
  level_coeff: number;
  work_order_count: number;
  item_count: number;
  total_value: number;
  total_hours: number;
}

export default async function PerformanceReportPage() {
  const supabase = await createClient();

  /* 业绩汇总改数据库端聚合（2026-09-19，9-15 诊断🟠#11）：
   * 原来 profiles/施工分配/施工日志/项目 4 张表全量拉到内存按人聚合，
   * 数据量涨后必超时。口径不变（完成项目=项目completed、参与工单=多人表∪旧单人字段去重、
   * 工时=complete日志秒转小时、只列在职员工、按分配业绩降序），逐行对照见迁移 0919_c。 */
  const { data: 汇总 } = await supabase.rpc("report_performance_summary");
  /* 未登录/异常时函数返回错误对象而非数组，防御为非数组即空 */
  const 员工统计 = (Array.isArray(汇总) ? 汇总 : []) as unknown as MechanicStatRow[];

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
              {员工统计.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">{s.name}</td>
                    <td className="px-6 py-4 text-gray-600">{s.level || "-"}</td>
                    <td className="px-6 py-4 text-gray-600">{s.level_coeff}</td>
                    <td className="px-6 py-4 text-gray-600">{s.work_order_count}</td>
                    <td className="px-6 py-4 text-gray-600">{s.item_count}</td>
                    <td className="px-6 py-4 font-medium text-gray-900">{formatCurrency(Number(s.total_value || 0))}</td>
                    <td className="px-6 py-4 text-gray-600">{Number(s.total_hours || 0).toFixed(1)}h</td>
                    <td className="px-6 py-4 text-gray-600">
                      {s.item_count > 0 ? (Number(s.total_hours || 0) / s.item_count).toFixed(1) : "0"}h
                    </td>
                  </tr>
                ))}
              {员工统计.length === 0 && (
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
