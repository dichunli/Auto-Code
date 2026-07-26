"use client";

import { useEffect, useState } from "react";
import NewItemRow from "./NewItemRow";

interface 新项目 {
  id: string;
  name: string;
  alias_name?: string | null;
  item_type: string;
  description?: string | null;
  quantity: number;
  unit_price: number;
  total_price?: number;
  service_item_id?: string | null;
  customer_opinion?: string;
  business_type?: string;
}

interface 组信息 {
  id: string;
  name: string;
  members: unknown[];
}

interface Props {
  reqId: string;
  需求序号: number;
  初始项目数: number;
  /* 服务端已渲染的项目 id 列表：整页刷新后清理已入库的追加行，防重复显示 */
  已有项目IDs: string[];
  orderId: string;
  实际锁定: boolean;
  profiles: { id: string; full_name: string }[];
  mechanicGroups: 组信息[];
  vehicleModelId?: number | null;
  vehicleVin?: string;
  suppliers?: unknown[];
  logisticsCompanies?: unknown[];
}

/* 需求下"新添加项目"的追加容器（局部更新）：
 * 批量添加项目保存后监听"wo-items-added"事件，立即把新项目行追加到需求末尾，
 * 不整页刷新（与配件添加同一模式）。
 * 追加的行放在拖拽排序区之后，不参与拖拽；整页刷新后按 id 去重移除（服务端数据已含）。 */
export default function LiveItemsList({
  reqId,
  需求序号,
  初始项目数,
  已有项目IDs,
  orderId,
  实际锁定,
  profiles,
  mechanicGroups,
  vehicleModelId,
  vehicleVin,
  suppliers = [],
  logisticsCompanies = [],
}: Props) {
  const [追加项目, 设置追加项目] = useState<新项目[]>([]);

  // 监听批量添加事件，立即追加项目行
  useEffect(() => {
    function handle(e: Event) {
      const detail = (e as CustomEvent).detail as { requirementId: string; items: 新项目[] };
      if (detail.requirementId !== reqId) return;
      设置追加项目((prev) => {
        const 新id集 = new Set(prev.map((p) => p.id));
        const 新项目 = detail.items.filter((it) => !新id集.has(it.id));
        return [...prev, ...新项目];
      });
    }
    window.addEventListener("wo-items-added", handle as EventListener);
    return () => window.removeEventListener("wo-items-added", handle as EventListener);
  }, [reqId]);

  // 监听删除事件，追加的行被删除时立即移除
  useEffect(() => {
    function handle(e: Event) {
      const detail = (e as CustomEvent).detail as { itemId: string; deleted?: boolean };
      if (detail.deleted) {
        设置追加项目((prev) => prev.filter((p) => p.id !== detail.itemId));
      }
    }
    window.addEventListener("wo-item-update", handle as EventListener);
    return () => window.removeEventListener("wo-item-update", handle as EventListener);
  }, []);

  // 整页刷新后：新项目已进服务端数据，从追加列表移除（去重防重复显示）
  const 已有IDs拼串 = 已有项目IDs.join(",");
  useEffect(() => {
    设置追加项目((prev) => prev.filter((p) => !已有项目IDs.includes(p.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [已有IDs拼串]);

  if (追加项目.length === 0) return null;

  return (
    <>
      {追加项目.map((item, idx) => (
        <NewItemRow
          key={item.id}
          item={item}
          序号={`${需求序号}.${初始项目数 + idx + 1}`}
          orderId={orderId}
          实际锁定={实际锁定}
          profiles={profiles}
          mechanicGroups={mechanicGroups}
          vehicleModelId={vehicleModelId}
          vehicleVin={vehicleVin}
          suppliers={suppliers}
          logisticsCompanies={logisticsCompanies}
        />
      ))}
    </>
  );
}
