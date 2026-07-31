import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";

/* 库存报表行（含名称和分类）
   成本口径:优先最新采购价 purchase_price,其次成本价 unit_cost */
interface 库存行 {
  id: string;
  name?: string | null;
  quantity?: number | null;
  purchase_price?: number | null;
  unit_cost?: number | null;
  part_names?: { name?: string | null } | null;
  part_categories?: { name?: string | null } | null;
}

/* 库存流水行(新口径: type + change_qty 有符号) */
interface 流水行 {
  type?: string | null;
  change_qty?: number | null;
}

function 行成本(p: 库存行): number {
  return p.purchase_price ?? p.unit_cost ?? 0;
}

export default async function InventoryReportPage() {
  const supabase = await createClient();

  const { data: parts } = await supabase
    .from("parts")
    .select("id, name, quantity, purchase_price, unit_cost, part_names(name), part_categories(name)");

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const { data: inventoryLogs } = await supabase
    .from("inventory_logs")
    .select("type, change_qty, created_at")
    .gte("created_at", thirtyDaysAgo.toISOString());

  const 配件列表 = (parts as unknown as 库存行[] | null) || [];
  const 流水列表 = (inventoryLogs as unknown as 流水行[] | null) || [];

  const totalStock = 配件列表.reduce((sum, p) => sum + (p.quantity || 0), 0);
  const totalValue = 配件列表.reduce((sum, p) => sum + (p.quantity || 0) * 行成本(p), 0);
  /* 入库类(正数):采购入库 inbound、退料回库 return_in;出库类(负数):领料 outbound、退货 return_out */
  const totalIn = 流水列表
    .filter((l) => (l.change_qty || 0) > 0)
    .reduce((sum, l) => sum + (l.change_qty || 0), 0);
  const totalOut = 流水列表
    .filter((l) => (l.change_qty || 0) < 0)
    .reduce((sum, l) => sum + Math.abs(l.change_qty || 0), 0);

  /* 只显示有库存或有成本的配件,按库存价值从高到低 */
  const 展示行 = 配件列表
    .filter((p) => (p.quantity || 0) !== 0 || 行成本(p) > 0)
    .sort((a, b) => (b.quantity || 0) * 行成本(b) - (a.quantity || 0) * 行成本(a));

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
                <th className="px-6 py-3 text-left font-medium text-gray-500">成本价</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">库存价值</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {展示行.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">
                    {p.part_names?.name || p.name || "-"}
                  </td>
                  <td className="px-6 py-4 text-gray-600">{p.part_categories?.name || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{p.quantity || 0}</td>
                  <td className="px-6 py-4 text-gray-600">{formatCurrency(行成本(p))}</td>
                  <td className="px-6 py-4 text-gray-900">
                    {formatCurrency((p.quantity || 0) * 行成本(p))}
                  </td>
                </tr>
              ))}
              {展示行.length === 0 && (
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
