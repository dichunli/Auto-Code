export const dynamic = 'force-dynamic';

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import InventoryTable from "./InventoryTable";

export default async function InventoryPage() {
  const supabase = await createClient();

  const 配件查询字段 = "*, part_names(name, unit, part_categories(name)), part_brands(name), suppliers(name), parts_specifications(specification_id, part_specifications(name))" as const;

  /* 分批拉取全部配件，替代原 .limit(500) 硬截断——
   * 超过 500 条的配件之前在库存页静默消失（不报错不提示）。
   * 列表交互（即时搜索/跨页勾选/合并配件）依赖全量本地数据，故保持全量加载，
   * 渲染层已有 20 条/页的客户端分页，几千条配件过滤耗时 <10ms 可接受 */
  const 批大小 = 1000;
  const { data: 第一批 } = await supabase
    .from("parts")
    .select(配件查询字段)
    .order("created_at", { ascending: false })
    .range(0, 批大小 - 1);
  const items = [...(第一批 || [])];
  /* 第一批拉满说明可能还有存货，继续逐批拉取直到不足一批 */
  if (第一批 && 第一批.length === 批大小) {
    for (let from = 批大小; ; from += 批大小) {
      const { data: batch } = await supabase
        .from("parts")
        .select(配件查询字段)
        .order("created_at", { ascending: false })
        .range(from, from + 批大小 - 1);
      if (!batch || batch.length === 0) break;
      items.push(...batch);
      if (batch.length < 批大小) break;
    }
  }

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
