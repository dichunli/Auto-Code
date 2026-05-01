import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate } from "@/lib/utils";

export default async function PayrollPage() {
  const supabase = await createClient();

  const { data: records } = await supabase
    .from("payroll_records")
    .select("*, profiles(full_name, mechanic_levels(name))")
    .order("period_start", { ascending: false });

  const statusMap: Record<string, { label: string; class: string }> = {
    draft: { label: "草稿", class: "bg-gray-50 text-gray-600" },
    approved: { label: "已审批", class: "bg-blue-50 text-blue-700" },
    paid: { label: "已发放", class: "bg-green-50 text-green-700" },
  };

  const totalBase = records?.reduce((sum, r) => sum + (r.base_salary || 0), 0) || 0;
  const totalCommission = records?.reduce((sum, r) => sum + (r.commission_total || 0), 0) || 0;
  const totalAmount = records?.reduce((sum, r) => sum + (r.total_amount || 0), 0) || 0;

  return (
    <div className="space-y-6">
      <PageHeader title="工资提成" description="员工工资与提成记录" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">基本工资合计</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(totalBase)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">提成合计</div>
          <div className="text-xl font-bold text-blue-600 mt-1">{formatCurrency(totalCommission)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">实发合计</div>
          <div className="text-xl font-bold text-green-600 mt-1">{formatCurrency(totalAmount)}</div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">员工</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">核算周期</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">基本工资</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">诊断提成</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">维修提成</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">销售提成</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">提成合计</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">奖金/扣款</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">实发金额</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {records?.map((r: any) => {
                const s = statusMap[r.status] || { label: r.status, class: "bg-gray-50 text-gray-600" };
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{r.profiles?.full_name || "-"}</div>
                      <div className="text-xs text-gray-500">{r.profiles?.mechanic_levels?.name || ""}</div>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {r.period_start} ~ {r.period_end}
                    </td>
                    <td className="px-6 py-4 text-gray-900">{formatCurrency(r.base_salary)}</td>
                    <td className="px-6 py-4 text-gray-600">{formatCurrency(r.commission_diagnosis)}</td>
                    <td className="px-6 py-4 text-gray-600">{formatCurrency(r.commission_repair)}</td>
                    <td className="px-6 py-4 text-gray-600">{formatCurrency(r.commission_sales)}</td>
                    <td className="px-6 py-4 font-medium text-blue-600">{formatCurrency(r.commission_total)}</td>
                    <td className="px-6 py-4 text-gray-600">
                      {r.bonus > 0 && <span className="text-green-600">+{formatCurrency(r.bonus)}</span>}
                      {r.deduction > 0 && <span className="text-red-600">-{formatCurrency(r.deduction)}</span>}
                      {r.bonus === 0 && r.deduction === 0 && "-"}
                    </td>
                    <td className="px-6 py-4 font-bold text-gray-900">{formatCurrency(r.total_amount)}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2 py-0.5 rounded ${s.class}`}>{s.label}</span>
                    </td>
                  </tr>
                );
              })}
              {(!records || records.length === 0) && (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center text-gray-400">暂无工资记录</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
