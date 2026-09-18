import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";

/* 利润分析口径说明:
   - 营收 = 已结算/已交车工单的订单总额(配件+工时+其他收费)
   - 配件成本 = 工单选中配件分支的真实成本(优先含分摊运费的 cost_price,其次 unit_cost)
   - 工时成本 = 技师提成总额(work_order_item_mechanics.commission_amount)
   - 工单其它成本 = work_order_other_costs 明细合计(退货运费分摊等，2026-09-18 起)
   - 毛利 = 营收 - 配件成本
   - 净利润 = 毛利 - 工时提成 - 工单其它成本 - 运营支出 + 其他收入 */

export default async function ProfitReportPage() {
  const supabase = await createClient();

  /* 汇总数字改数据库端聚合（2026-09-19，9-15 诊断🟠#11）：
   * 原来 5 张表全量拉到内存加总（工单/配件分支/提成/其它成本/财务流水），
   * 数据量涨后报表页必超时。口径不变，逐行对照见迁移 0919_c 注释。 */
  const { data: 汇总 } = await supabase.rpc("report_profit_summary");
  const s = (汇总 || {}) as Record<string, number>;
  const totalRevenue = Number(s.total_revenue || 0);
  const totalPartsSales = Number(s.parts_sales || 0);
  const totalLaborSales = Number(s.labor_sales || 0);
  const totalOtherSales = Number(s.other_sales || 0);
  const totalPartsRealCost = Number(s.parts_real_cost || 0);
  const totalCommission = Number(s.commission || 0);
  const totalOtherCosts = Number(s.other_costs || 0);
  const totalOperatingExpense = Number(s.operating_expense || 0);
  const totalOtherIncome = Number(s.other_income || 0);

  const grossProfit = totalRevenue - totalPartsRealCost;
  const netProfit = grossProfit - totalCommission - totalOtherCosts - totalOperatingExpense + totalOtherIncome;
  const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
  const netMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="利润分析" description="收入、真实成本、毛利与净利润分析" />

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
          <h3 className="font-semibold text-gray-900 mb-4">收入构成</h3>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">配件收入</span>
              <span className="font-medium text-gray-900">{formatCurrency(totalPartsSales)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">工时收入</span>
              <span className="font-medium text-gray-900">{formatCurrency(totalLaborSales)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">其他收费</span>
              <span className="font-medium text-gray-900">{formatCurrency(totalOtherSales)}</span>
            </div>
            <div className="border-t pt-2 flex justify-between text-sm">
              <span className="text-gray-900 font-medium">总营收</span>
              <span className="font-bold text-gray-900">{formatCurrency(totalRevenue)}</span>
            </div>
          </div>

          <h3 className="font-semibold text-gray-900 mb-4 mt-6">成本构成</h3>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">配件成本（真实进价）</span>
              <span className="font-medium text-gray-900">{formatCurrency(totalPartsRealCost)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">技师提成</span>
              <span className="font-medium text-gray-900">{formatCurrency(totalCommission)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">工单其它成本（退货运费等）</span>
              <span className="font-medium text-gray-900">{formatCurrency(totalOtherCosts)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">运营支出</span>
              <span className="font-medium text-gray-900">{formatCurrency(totalOperatingExpense)}</span>
            </div>
            <div className="border-t pt-2 flex justify-between text-sm">
              <span className="text-gray-900 font-medium">总成本</span>
              <span className="font-bold text-red-600">
                {formatCurrency(totalPartsRealCost + totalCommission + totalOtherCosts + totalOperatingExpense)}
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
              <span className="font-medium text-red-600">-{formatCurrency(totalPartsRealCost)}</span>
            </div>
            <div className="border-t pt-2 flex justify-between text-sm">
              <span className="text-gray-900 font-medium">毛利</span>
              <span className="font-bold text-blue-600">{formatCurrency(grossProfit)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">减：技师提成</span>
              <span className="font-medium text-red-600">-{formatCurrency(totalCommission)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">减：工单其它成本（退货运费等）</span>
              <span className="font-medium text-red-600">-{formatCurrency(totalOtherCosts)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">减：运营支出</span>
              <span className="font-medium text-red-600">-{formatCurrency(totalOperatingExpense)}</span>
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
