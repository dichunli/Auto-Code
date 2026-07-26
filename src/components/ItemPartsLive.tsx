"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import ItemPartGroup from "./ItemPartGroup";
import SortableList from "./SortableList";
import type { PartBranch, PartGroupInfo } from "@/lib/workOrderView";

/* 与 workOrderView 相同的配件分组逻辑：按目录（branch_group_id）分组，
 * 组内按 sort_order 排序，第一个分支为代表分支 */
function 分组配件(配件列表: PartBranch[]): PartGroupInfo[] {
  const groups: Record<string, { name: string; parts: PartBranch[] }> = {};
  for (const p of 配件列表) {
    const key = p.branch_group_id || p.part_name_id || `no_name_${p.id}`;
    if (!groups[key]) {
      groups[key] = {
        name: p.alias_name || p.parts?.name || p.name || p.part_names?.name || "未命名配件",
        parts: [],
      };
    }
    groups[key].parts.push(p);
  }
  const groupList: PartGroupInfo[] = [];
  for (const group of Object.values(groups)) {
    group.parts.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const rep = group.parts[0];
    if (!rep) continue;
    groupList.push({
      name: group.name,
      parts: group.parts,
      repId: rep.id,
      repSort: rep.sort_order || 0,
      extraIds: group.parts.map((p) => p.id),
      images: [],
    });
  }
  groupList.sort((a, b) => a.repSort - b.repSort);
  return groupList;
}

interface Props {
  itemId: string;
  orderId: string;
  seqPrefix: string;
  isLocked: boolean;
  vehicleModelId?: number | null;
  suppliers: unknown[];
  logisticsCompanies: unknown[];
  pickingByPart: Record<string, number>;
  returnByPart: Record<string, number>;
  inventoryByPart: Record<string, number>;
  pendingSupplierReturnByPart: Record<string, number>;
  imagesByPart: Record<string, { storage_path: string | null }[]>;
  children: ReactNode;
}

/* 项目配件区容器（局部更新）：
 * 初始显示服务端渲染的配件区（children）；添加配件后监听"wo-parts-reload"事件，
 * 只重查"这一个项目的配件"（1 张表），用现有 ItemPartGroup 重新渲染配件区，
 * 不整页刷新。领料/库存/退货等关联数据复用服务端传入的（新配件默认空，正确）。 */
export default function ItemPartsLive({
  itemId,
  orderId,
  seqPrefix,
  isLocked,
  vehicleModelId,
  suppliers,
  logisticsCompanies,
  pickingByPart,
  returnByPart,
  inventoryByPart,
  pendingSupplierReturnByPart,
  imagesByPart,
  children,
}: Props) {
  const supabase = createClient();
  const [重查组列表, 设置重查组列表] = useState<PartGroupInfo[] | null>(null);

  useEffect(() => {
    async function 重查配件() {
      const { data: 配件 } = await supabase
        .from("work_order_item_parts")
        .select("*, part_names(name), parts(name)")
        .eq("work_order_item_id", itemId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      设置重查组列表(分组配件((配件 || []) as PartBranch[]));
    }
    function handle(e: Event) {
      const detail = (e as CustomEvent).detail as { itemId: string };
      if (detail.itemId === itemId) {
        重查配件();
      }
    }
    window.addEventListener("wo-parts-reload", handle as EventListener);
    return () => window.removeEventListener("wo-parts-reload", handle as EventListener);
  }, [itemId, supabase]);

  // 未触发过重查：显示服务端渲染的原始内容
  if (重查组列表 === null) {
    return <>{children}</>;
  }

  // 重查后：用最新数据重新渲染配件区
  const extraIdMap: Record<string, string[]> = {};
  for (const g of 重查组列表) extraIdMap[g.repId] = g.extraIds;

  return (
    <div className="hidden md:block mt-3 ml-2 bg-white rounded-lg border border-gray-200 p-3 text-xs space-y-2 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-1 h-4 bg-amber-400 rounded-full" />
        <span className="text-[11px] font-semibold text-gray-700">所用配件</span>
      </div>
      {重查组列表.length === 0 ? (
        <p className="text-xs text-gray-400">暂无配件</p>
      ) : (
        <SortableList
          ids={重查组列表.map((g) => g.repId)}
          groupKey={itemId}
          tableName="work_order_item_parts"
          extraIdMap={extraIdMap}
        >
          {重查组列表.map((group) => (
            <ItemPartGroup
              key={group.repId}
              group={group}
              itemId={itemId}
              需求序号={Number(seqPrefix.split(".")[0]) || 1}
              isLocked={isLocked}
              vehicleModelId={vehicleModelId}
              suppliers={suppliers}
              logisticsCompanies={logisticsCompanies}
              pickingByPart={pickingByPart}
              returnByPart={returnByPart}
              inventoryByPart={inventoryByPart}
              pendingSupplierReturnByPart={pendingSupplierReturnByPart}
              imagesByPart={imagesByPart}
            />
          ))}
        </SortableList>
      )}
    </div>
  );
}
