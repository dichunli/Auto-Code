import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";

export default async function InventoryPage() {
  const supabase = await createClient();

  const { data: items } = await supabase
    .from("parts")
    .select("*, part_names(name, unit, part_categories(name)), part_brands(name), suppliers(name)")
    .order("created_at", { ascending: false });

  const { count: lowStock } = await supabase
    .from("parts")
    .select("*", { count: "exact", head: true })
    .lte("quantity", 10);

  return (
    <div>
      <PageHeader
        title="配件库存"
        description={`低库存预警: ${lowStock || 0} 项`}
        action={{ href: "/inventory/new", label: "新增配件" }}
      />

      <div className="flex flex-wrap gap-2 mb-6">
        <Link href="/inventory/in" className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
          入库登记
        </Link>
        <Link href="/procurement" className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
          采购订单
        </Link>
        <Link href="/suppliers" className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
          供应商
        </Link>
        <Link href="/part-categories" className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
          配件分类
        </Link>
        <Link href="/part-names" className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
          名称库
        </Link>
        <Link href="/part-brands" className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
          品牌
        </Link>
        <Link href="/part-specifications" className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
          规格
        </Link>
        <Link href="/inventory/checks" className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
          库存盘点
        </Link>
        <Link href="/inventory/returns" className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
          供应商退货
        </Link>
        <Link href="/inventory/plate-parts" className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
          绑定车牌配件
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">配件编号</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">分类</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">品牌</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">库存</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">成本价</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">销售价</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">存放位置</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items?.map((item: any) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{item.part_number}</td>
                  <td className="px-6 py-4 text-gray-900">{item.name}</td>
                  <td className="px-6 py-4 text-gray-600">{item.part_names?.part_categories?.name || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{item.part_brands?.name || "-"}</td>
                  <td className="px-6 py-4">
                    <span className={`font-medium ${item.quantity <= item.min_stock ? "text-red-600" : "text-gray-900"}`}>
                      {item.quantity}
                    </span>
                    {item.quantity <= item.min_stock && (
                      <span className="ml-2 text-xs text-red-600 bg-red-50 px-1.5 py-0.5 rounded">库存不足</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-gray-600">{formatCurrency(item.unit_cost)}</td>
                  <td className="px-6 py-4 text-gray-600">{formatCurrency(item.unit_price)}</td>
                  <td className="px-6 py-4 text-gray-500">{item.location || "-"}</td>
                </tr>
              ))}
              {(!items || items.length === 0) && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-400">暂无配件数据</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
