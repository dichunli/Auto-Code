import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate } from "@/lib/utils";

export default async function RevenueReportPage() {
  const supabase = await createClient();

  const { data: dailyData } = await supabase
    .from("v_daily_revenue")
    .select("*")
    .limit(30);

  const totalRevenue = dailyData?.reduce((sum, d) => sum + (d.total_revenue || 0), 0) || 0;
  const totalPaid = dailyData?.reduce((sum, d) => sum + (d.total_paid || 0), 0) || 0;
  const totalOrders = dailyData?.reduce((sum, d) => sum + (d.order_count || 0), 0) || 0;

  return (
    <div className="space-y-6">
      <PageHeader title="营收报表" description="按日查看营业收入与回款情况" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">近30天营收</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(totalRevenue)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">近30天回款</div>
          <div className="text-xl font-bold text-green-600 mt-1">{formatCurrency(totalPaid)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">近30天工单数</div>
          <div className="text-xl font-bold text-blue-600 mt-1">{totalOrders} 单</div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">每日营收明细（最近30天）</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">日期</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">工单数</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">配件成本</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">工时费用</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">其他费用</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">营收总额</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">实收金额</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">差额</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {dailyData?.map((d: any) => (
                <tr key={d.date} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-gray-900 font-medium">{d.date}</td>
                  <td className="px-6 py-4 text-gray-600">{d.order_count}</td>
                  <td className="px-6 py-4 text-gray-600">{formatCurrency(d.total_parts_cost)}</td>
                  <td className="px-6 py-4 text-gray-600">{formatCurrency(d.total_labor_cost)}</td>
                  <td className="px-6 py-4 text-gray-600">{formatCurrency(d.total_other_cost)}</td>
                  <td className="px-6 py-4 font-medium text-gray-900">{formatCurrency(d.total_revenue)}</td>
                  <td className="px-6 py-4 text-green-600">{formatCurrency(d.total_paid)}</td>
                  <td className={`px-6 py-4 font-medium ${(d.total_revenue - d.total_paid) > 0 ? "text-red-600" : "text-gray-400"}`}>
                    {formatCurrency(d.total_revenue - d.total_paid)}
                  </td>
                </tr>
              ))}
              {(!dailyData || dailyData.length === 0) && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-400">
                    暂无营收数据
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
