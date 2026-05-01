import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";

export default async function InventoryReportPage() {
  const supabase = await createClient();

  const { data: parts } = await supabase
    .from("parts")
    .select("id, stock_quantity, average_cost, part_names(name), part_categories(name)");

  const { data: inventoryLogs } = await supabase
    .from("inventory_logs")
    .select("type, quantity, created_at")
    .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  const totalStock = parts?.reduce((sum, p) => sum + (p.stock_quantity || 0), 0) || 0;
  const totalValue = parts?.reduce((sum, p) => sum + (p.stock_quantity || 0) * (p.average_cost || 0), 0) || 0;
  const totalIn = inventoryLogs?.filter((l) => l.type === "in").reduce((sum, l) => sum + (l.quantity || 0), 0) || 0;
  const totalOut = inventoryLogs?.filter((l) => l.type === "out").reduce((sum, l) => sum + (l.quantity || 0), 0) || 0;

  return (
    <div className="space-y-6">
      <PageHeader title="库存周转" description="配件库存量、价值与出入库统计" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">总库存量</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{totalStock} 件</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">库存总价值</div>
          <div className="text-xl font-bold text-blue-600 mt-1">{formatCurrency(totalValue)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">30天入库</div>
          <div className="text-xl font-bold text-green-600 mt-1">{totalIn} 件</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">30天出库</div>
          <div className="text-xl font-bold text-orange-600 mt-1">{totalOut} 件</div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">配件库存明细</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">配件名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">分类</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">库存数量</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">平均成本</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">库存价值</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {parts?.map((p: any) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{p.part_names?.name || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{p.part_categories?.name || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{p.stock_quantity || 0}</td>
                  <td className="px-6 py-4 text-gray-600">{formatCurrency(p.average_cost)}</td>
                  <td className="px-6 py-4 text-gray-900">{formatCurrency((p.stock_quantity || 0) * (p.average_cost || 0))}</td>
                </tr>
              ))}
              {(!parts || parts.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
                    暂无配件数据
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
