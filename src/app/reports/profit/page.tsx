import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";

export default async function ProfitReportPage() {
  const supabase = await createClient();

  const { data: settledOrders } = await supabase
    .from("work_orders")
    .select("parts_cost, labor_cost, other_cost, total_cost, status")
    .in("status", ["settled", "delivered"]);

  const { data: expenses } = await supabase
    .from("finance_transactions")
    .select("amount, type")
    .eq("type", "expense");

  const { data: incomes } = await supabase
    .from("finance_transactions")
    .select("amount, type")
    .eq("type", "income");

  const totalRevenue = settledOrders?.reduce((sum, o) => sum + (o.total_cost || 0), 0) || 0;
  const totalPartsCost = settledOrders?.reduce((sum, o) => sum + (o.parts_cost || 0), 0) || 0;
  const totalLaborCost = settledOrders?.reduce((sum, o) => sum + (o.labor_cost || 0), 0) || 0;
  const totalOtherCost = settledOrders?.reduce((sum, o) => sum + (o.other_cost || 0), 0) || 0;
  const totalOperatingExpense = expenses?.reduce((sum, e) => sum + (e.amount || 0), 0) || 0;
  const totalOtherIncome = incomes?.reduce((sum, i) => sum + (i.amount || 0), 0) || 0;

  const grossProfit = totalRevenue - totalPartsCost;
  const netProfit = grossProfit - totalLaborCost - totalOtherCost - totalOperatingExpense + totalOtherIncome;
  const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
  const netMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="利润分析" description="收入、成本、毛利与净利润分析" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">总营收</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(totalRevenue)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">毛利</div>
          <div className="text-xl font-bold text-blue-600 mt-1">{formatCurrency(grossProfit)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">毛利率</div>
          <div className="text-xl font-bold text-blue-600 mt-1">{grossMargin.toFixed(1)}%</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">净利润</div>
          <div className={`text-xl font-bold mt-1 ${netProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
            {formatCurrency(netProfit)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">成本构成</h3>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">配件成本</span>
              <span className="font-medium text-gray-900">{formatCurrency(totalPartsCost)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">工时成本</span>
              <span className="font-medium text-gray-900">{formatCurrency(totalLaborCost)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">其他成本</span>
              <span className="font-medium text-gray-900">{formatCurrency(totalOtherCost)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">运营支出</span>
              <span className="font-medium text-gray-900">{formatCurrency(totalOperatingExpense)}</span>
            </div>
            <div className="border-t pt-2 flex justify-between text-sm">
              <span className="text-gray-900 font-medium">总成本</span>
              <span className="font-bold text-red-600">
                {formatCurrency(totalPartsCost + totalLaborCost + totalOtherCost + totalOperatingExpense)}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">利润计算</h3>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">营业收入</span>
              <span className="font-medium text-gray-900">{formatCurrency(totalRevenue)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">减：配件成本</span>
              <span className="font-medium text-red-600">-{formatCurrency(totalPartsCost)}</span>
            </div>
            <div className="border-t pt-2 flex justify-between text-sm">
              <span className="text-gray-900 font-medium">毛利</span>
              <span className="font-bold text-blue-600">{formatCurrency(grossProfit)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">减：工时/其他/运营</span>
              <span className="font-medium text-red-600">
                -{formatCurrency(totalLaborCost + totalOtherCost + totalOperatingExpense)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">加：其他收入</span>
              <span className="font-medium text-green-600">+{formatCurrency(totalOtherIncome)}</span>
            </div>
            <div className="border-t pt-2 flex justify-between text-sm">
              <span className="text-gray-900 font-medium">净利润</span>
              <span className={`font-bold ${netProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatCurrency(netProfit)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">净利率</span>
              <span className={`font-medium ${netMargin >= 0 ? "text-green-600" : "text-red-600"}`}>
                {netMargin.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
