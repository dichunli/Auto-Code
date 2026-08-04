"use client";

import { useEffect, useState } from "react";
import ItemNameDisplay from "./ItemNameDisplay";
import { ItemPersonSelectors } from "./ItemPersonSelectors";
import { CustomerOpinionToggle } from "./CustomerOpinionToggle";
import { BusinessTypeToggle } from "./BusinessTypeToggle";
import { ItemFlagsToggle } from "./ItemFlagsToggle";
import { ItemNotesEditor } from "./ItemNotesEditor";
import ItemImageUploader from "./ItemImageUploader";
import AddItemPartButton from "./AddItemPartButton";
import { WorkOrderItemActions } from "./WorkOrderItemActions";
import ItemSubtotalDisplay from "./ItemSubtotalDisplay";
import ItemPartsLive from "./ItemPartsLive";

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
  item: 新项目;
  序号: string;
  orderId: string;
  实际锁定: boolean;
  profiles: { id: string; full_name: string }[];
  mechanicGroups: 组信息[];
  vehicleModelId?: number | null;
  vehicleVin?: string;
  suppliers?: unknown[];
  logisticsCompanies?: unknown[];
}

/* 新添加项目的行渲染（局部更新用）：
 * 与 page.tsx 服务端渲染的项目行保持一致（同样的子组件、同样的布局），
 * 用于"批量添加项目"后立即显示，不整页刷新。
 * 新项目无派工/无配件/无图片/无知识链接，对应区域传空即可。
 * 提成与施工计时未渲染：新项目本就无提成配置、未派工不可施工，整页刷新后自然出现。 */
export default function NewItemRow({
  item,
  序号,
  orderId,
  实际锁定,
  profiles,
  mechanicGroups,
  vehicleModelId,
  vehicleVin,
  suppliers = [],
  logisticsCompanies = [],
}: Props) {
  /* 添加配件成功后（弹窗广播 wo-parts-reload）隐藏"配件：无"提示，
   * 配件列表由下方 ItemPartsLive 局部刷新展示 */
  const [已有配件, 设已有配件] = useState(false);
  useEffect(() => {
    function 监听重查(e: Event) {
      const detail = (e as CustomEvent).detail as { itemId?: string };
      if (detail?.itemId === item.id) 设已有配件(true);
    }
    window.addEventListener("wo-parts-reload", 监听重查 as EventListener);
    return () => window.removeEventListener("wo-parts-reload", 监听重查 as EventListener);
  }, [item.id]);

  return (
    <div className={`rounded-lg px-4 py-3 text-sm mb-2 ${item.item_type === "labor" ? "bg-blue-50/60 border-l-4 border-blue-300" : "bg-gray-50/60 border-l-4 border-gray-300"}`}>
      <div className="hidden md:block overflow-x-auto relative">
        <div className="flex items-center min-w-max">
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-gray-400 font-mono">{序号}</span>
            <ItemNameDisplay itemId={item.id} name={item.name || ""} aliasName={item.alias_name} />
            <ItemPersonSelectors
              itemId={item.id}
              submitterId={undefined}
              mechanicId={undefined}
              inspectorId={undefined}
              profiles={profiles}
              mechanicGroups={mechanicGroups}
              existingMechanics={[]}
              disabled={实际锁定}
            />
            <div className="ml-6">
              <CustomerOpinionToggle itemId={item.id} opinion={item.customer_opinion || "pending"} disabled={实际锁定} />
            </div>
            <BusinessTypeToggle itemId={item.id} businessType={item.business_type || "normal"} disabled={实际锁定} />
            <div className="ml-4">
              <ItemFlagsToggle
                itemId={item.id}
                isOutsourced={false}
                isCustomerPart={false}
                serviceItemId={item.service_item_id}
                workOrderId={orderId}
                itemName={item.name}
                existingOrder={null}
                existingItem={null}
                disabled={实际锁定}
              />
            </div>
            <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-400 ml-2">维修指导</span>
            <div className="ml-4">
              <ItemNotesEditor itemId={item.id} description={item.description} disabled={实际锁定} />
            </div>
            <div className="ml-[10ch]">
              <ItemImageUploader itemId={item.id} existingImages={[]} isLocked={实际锁定} />
            </div>
          </div>
          <div className="w-[10ch] flex-shrink-0" />
          <div className={`flex items-center gap-2 flex-shrink-0 sticky right-0 pl-2 ${item.item_type === "labor" ? "bg-blue-50" : "bg-gray-50"}`}>
            {/* 添加配件 / 编辑删除项目：只读（保养单未编辑、工单锁定）时隐藏 */}
            {!实际锁定 && (
              <>
                <AddItemPartButton
                  itemId={item.id}
                  serviceItemId={item.service_item_id}
                  itemName={item.alias_name || item.name}
                  vehicleModelId={vehicleModelId}
                  vin={vehicleVin}
                />
                <WorkOrderItemActions
                  itemId={item.id}
                  itemName={item.name}
                  aliasName={item.alias_name}
                  quantity={item.quantity}
                  unitPrice={item.unit_price}
                  serviceItemId={item.service_item_id}
                />
              </>
            )}
          </div>
        </div>
      </div>
      {/* 移动端简版（整页刷新后恢复完整卡片）：项目名 + 配件入口。
         新项目必然无配件，显示"配件：无 + 添加配件"；通过弹窗添加后
         监听重查事件把"配件：无"藏掉（配件区由下方 ItemPartsLive 局部刷新展示） */}
      <div className="md:hidden text-sm flex items-center justify-between gap-2">
        <span className="font-medium text-gray-900">{item.alias_name || item.name}</span>
        {!已有配件 && (
          <span className="flex items-center gap-1.5 text-xs text-gray-400 shrink-0">
            配件：无
            {!实际锁定 && (
              <AddItemPartButton
                itemId={item.id}
                serviceItemId={item.service_item_id}
                itemName={item.alias_name || item.name}
                vehicleModelId={vehicleModelId}
                vin={vehicleVin}
              />
            )}
          </span>
        )}
      </div>
      {/* 项目价格 + 小计 */}
      <ItemSubtotalDisplay
        itemId={item.id}
        itemTotalPrice={item.total_price || 0}
        parts={[]}
      />
      {/* 配件区（局部更新）：添加/删除配件后 ItemPartsLive 只重查该项目配件，立即显示。
         新项目无领料/退货/库存/图片记录，关联数据传空。 */}
      <ItemPartsLive
        itemId={item.id}
        orderId={orderId}
        seqPrefix={序号}
        isLocked={实际锁定}
        vehicleModelId={vehicleModelId}
        suppliers={suppliers}
        logisticsCompanies={logisticsCompanies}
        pickingByPart={{}}
        returnByPart={{}}
        inventoryByPart={{}}
        pendingSupplierReturnByPart={{}}
        imagesByPart={{}}
      >
        {null}
      </ItemPartsLive>
    </div>
  );
}
