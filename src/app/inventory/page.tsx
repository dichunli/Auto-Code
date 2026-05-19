export const dynamic = 'force-dynamic';

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import InventoryTable from "./InventoryTable";

export default async function InventoryPage() {
  const supabase = await createClient();

  const { data: items } = await supabase
    .from("parts")
    .select("*, part_names(name, unit, part_categories(name)), part_brands(name), suppliers(name), parts_specifications(specification_id, part_specifications(name))")
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
        action={{ href: "/parts/new", label: "新增配件" }}
      />

      <div className="flex flex-wrap gap-2 mb-6">
        <Link href="/inventory" className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
          配件列表
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
        <Link href="/inventory/warehouses" className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
          仓库管理
        </Link>
        <Link href="/inventory/batches" className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
          批次管理
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden p-4">
        <InventoryTable items={items || []} />
      </div>
    </div>
  );
}
