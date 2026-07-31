import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";

/* 利润分析口径说明:
   - 营收 = 已结算/已交车工单的订单总额(配件+工时+其他收费)
   - 配件成本 = 工单选中配件分支的真实成本(优先含分摊运费的 cost_price,其次 unit_cost)
   - 工时成本 = 技师提成总额(work_order_item_mechanics.commission_amount)
   - 毛利 = 营收 - 配件成本
   - 净利润 = 毛利 - 工时提成 - 运营支出 + 其他收入 */

interface 工单金额行 {
  id: string;
  parts_cost: number | null;
  labor_cost: number | null;
  other_cost: number | null;
  total_cost: number | null;
}

interface 配件分支成本行 {
  quantity: number | null;
  cost_price: number | null;
  unit_cost: number | null;
}

interface 提成行 {
  commission_amount: number | null;
}

interface 收支行 {
  amount: number | null;
}

export default async function ProfitReportPage() {
  const supabase = await createClient();

  const { data: settledOrdersRaw } = await supabase
    .from("work_orders")
    .select("id, parts_cost, labor_cost, other_cost, total_cost")
    .in("status", ["settled", "delivered"]);
  const settledOrders = (settledOrdersRaw || []) as unknown as 工单金额行[];

  /* 逐步查出这些工单的真实配件成本和技师提成 */
  const orderIds = settledOrders.map((o) => o.id);
  let totalPartsRealCost = 0;
  let totalCommission = 0;
  if (orderIds.length > 0) {
    const { data: itemsRaw } = await supabase
      .from("work_order_items")
      .select("id")
      .in("work_order_id", orderIds);
    const itemIds = ((itemsRaw || []) as unknown as { id: string }[]).map((i) => i.id);

    if (itemIds.length > 0) {
      const [分支结果, 提成结果] = await Promise.all([
        supabase
          .from("work_order_item_parts")
          .select("quantity, cost_price, unit_cost")
          .in("work_order_item_id", itemIds)
          .eq("is_selected", true),
        supabase
          .from("work_order_item_mechanics")
          .select("commission_amount")
          .in("work_order_item_id", itemIds),
      ]);

      totalPartsRealCost = ((分支结果.data || []) as unknown as 配件分支成本行[]).reduce(
        (sum, b) => sum + (b.quantity || 0) * (b.cost_price ?? b.unit_cost ?? 0),
        0
      );
      totalCommission = ((提成结果.data || []) as unknown as 提成行[]).reduce(
        (sum, m) => sum + (m.commission_amount || 0),
        0
      );
    }
  }

  const { data: expensesRaw } = await supabase
    .from("finance_transactions")
    .select("amount")
    .eq("type", "expense");
  const { data: incomesRaw } = await supabase
    .from("finance_transactions")
    .select("amount")
    .eq("type", "income");

  const totalRevenue = settledOrders.reduce((sum, o) => sum + (o.total_cost || 0), 0);
  const totalPartsSales = settledOrders.reduce((sum, o) => sum + (o.parts_cost || 0), 0);
  const totalLaborSales = settledOrders.reduce((sum, o) => sum + (o.labor_cost || 0), 0);
  const totalOtherSales = settledOrders.reduce((sum, o) => sum + (o.other_cost || 0), 0);
  const totalOperatingExpense = ((expensesRaw || []) as unknown as 收支行[]).reduce(
    (sum, e) => sum + (e.amount || 0),
    0
  );
  const totalOtherIncome = ((incomesRaw || []) as unknown as 收支行[]).reduce(
    (sum, i) => sum + (i.amount || 0),
    0
  );

  const grossProfit = totalRevenue - totalPartsRealCost;
  const netProfit = grossProfit - totalCommission - totalOperatingExpense + totalOtherIncome;
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
              <span className="text-gray-600">运营支出</span>
              <span className="font-medium text-gray-900">{formatCurrency(totalOperatingExpense)}</span>
            </div>
            <div className="border-t pt-2 flex justify-between text-sm">
              <span className="text-gray-900 font-medium">总成本</span>
              <span className="font-bold text-red-600">
                {formatCurrency(totalPartsRealCost + totalCommission + totalOperatingExpense)}
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
