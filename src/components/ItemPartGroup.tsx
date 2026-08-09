"use client";

import { useState, useEffect, type ComponentProps } from "react";
import Link from "next/link";
import PartBranchEditor from "@/components/PartBranchEditor";
import PartGroupHeader from "@/components/PartGroupHeader";
import { PartBranchImages } from "@/components/PartBranchImages";
import { PartWorkflowActions } from "@/components/PartWorkflowActions";
import { ShowCommission } from "@/components/WorkOrderToggleContext";
import { calculatePartCommission } from "@/lib/commission";
import { getPartWorkflowStatus } from "@/lib/partWorkflow";
import type { PartBranch } from "@/lib/workOrderView";
import { useItemPosition, usePartPosition } from "@/lib/sortOrderContext";

// 一个「配件名称目录」= 组头 + 其下所有分支行，由本客户端组件统一掌管。
// 加分支/删分支/切换选中都在这里从当前实际分支列表计算，保证「每目录仅一个选中」
// 与「小计口径」始终正确，且加分支能即时出现，无需整页刷新（远程库省一次 5 秒往返）。

interface SupplierLite {
  id: string;
  name: string;
  recommendation_level?: number | null;
}
interface LogisticsLite {
  id: string;
  name: string;
}

interface Props {
  group: { repId: string; name: string; parts: PartBranch[]; extraIds: string[]; images: string[] };
  itemId: string;
  需求序号: number; // 需求在工单内的序号（显示序号），序号前两段由此和排序 Context 动态计算
  isLocked: boolean;
  vehicleModelId?: number;
  suppliers: SupplierLite[];
  logisticsCompanies: LogisticsLite[];
  pickingByPart: Record<string, number>;
  returnByPart: Record<string, number>;
  inventoryByPart: Record<string, number>;
  pendingSupplierReturnByPart: Record<string, boolean>;
  /* 待出库申领数（按分支）：手机端师傅申领后桌面行显示"已申领"角标，库管实领自动核销 */
  申领ByPart?: Record<string, number>;
  imagesByPart: Record<string, { id?: string; storage_path?: string }[]>;
}

export default function ItemPartGroup({
  group,
  itemId,
  需求序号,
  isLocked,
  vehicleModelId,
  suppliers,
  logisticsCompanies,
  pickingByPart,
  returnByPart,
  inventoryByPart,
  pendingSupplierReturnByPart,
  申领ByPart = {},
  imagesByPart,
}: Props) {
  // 序号前缀（形如 "1.1.1"）：项目位置 + 组位置从排序 Context 实时读取，拖拽后自动重排
  const 项目位置 = useItemPosition(itemId);
  const 组位置 = usePartPosition(group.repId);
  const seqPrefix = `${需求序号}.${项目位置}.${组位置}`;
  // 分支列表本地状态：服务端初始数据 + 本地加/删的实时变化
  const [branches, setBranches] = useState<PartBranch[]>(group.parts);

  // 服务端重新渲染（router.refresh / F5）后，用最新 props 覆盖本地状态
  useEffect(() => {
    setBranches(group.parts);
  }, [group.parts]);

  // 监听删除广播：分支被删（PartBranchEditor 内已发 deleted 广播并自行隐藏），
  // 这里同步从列表移除，保证 canDelete / siblingIds 立即反映真实分支数。
  useEffect(() => {
    function handleDeleted(e: Event) {
      const detail = (e as CustomEvent).detail as { partId?: string; deleted?: boolean } | null;
      if (!detail?.deleted || !detail.partId) return;
      setBranches((prev) => (prev.some((b) => b.id === detail.partId) ? prev.filter((b) => b.id !== detail.partId) : prev));
    }
    window.addEventListener("wo-part-update", handleDeleted as EventListener);
    return () => window.removeEventListener("wo-part-update", handleDeleted as EventListener);
  }, []);

  // 加分支成功回调：把数据库返回的真实整行追加到列表，新行即时出现
  function handleBranchAdded(newRow: PartBranch) {
    setBranches((prev) => [...prev, newRow]);
  }

  return (
    <div className="rounded-lg border border-gray-300 overflow-hidden bg-white shadow-sm">
      {/* 配件名称目录：蓝色标题栏（父级） */}
      <div className="bg-blue-50 px-3 py-2 border-b border-gray-200">
        <PartGroupHeader
          seqLabel={seqPrefix}
          name={group.name}
          parts={branches as unknown as ComponentProps<typeof PartGroupHeader>["parts"]}
          isLocked={isLocked}
          itemId={itemId}
          existingImages={group.images}
          onBranchAdded={handleBranchAdded as unknown as ComponentProps<typeof PartGroupHeader>["onBranchAdded"]}
        />
      </div>
      {/* 配件分支区：白底 + 蓝色缩进导轨（子级） */}
      <div className="px-3 py-3">
        <div className="space-y-3 pl-4 border-l-[3px] border-blue-300 ml-1">
          {branches.map((p: PartBranch, branchIdx: number) => {
            const pPickedQty = pickingByPart[p.id as string] || 0;
            const pReturnQty = returnByPart[p.id as string] || 0;
            const pNetPicked = pPickedQty - pReturnQty;
            const pInventory = inventoryByPart[(p.part_id as string) || ""] || 0;
            const pHasPendingSupplierReturn = pendingSupplierReturnByPart[p.id as string] || false;
            const pStatus = getPartWorkflowStatus({
              unit_cost: p.unit_cost as number | null,
              unit_price: p.unit_price as number | null,
              customer_opinion: p.customer_opinion as string | null,
              is_purchased: p.is_purchased as boolean,
              is_arrived: p.is_arrived as boolean,
              part_id: p.part_id as string | null,
              quantity: p.quantity as number,
              inventoryQty: pInventory,
              pickedQty: pNetPicked,
              hasReturnRecords: pReturnQty > 0,
              hasPendingSupplierReturn: pHasPendingSupplierReturn,
            });
            const partName = (p.alias_name as string) || p.parts?.name || (p.name as string) || p.part_names?.name || "未命名配件";
            return (
              <PartBranchEditor
                key={p.id}
                part={p as unknown as ComponentProps<typeof PartBranchEditor>["part"]}
                itemId={itemId}
                inventoryQty={pInventory}
                suppliers={suppliers}
                seqLabel={`${seqPrefix}.${branchIdx + 1}`}
                canDelete={branches.length > 1}
                siblingIds={branches.filter((sp) => sp.id !== p.id).map((sp) => sp.id)}
                vehicleModelId={vehicleModelId}
                isLocked={isLocked}
              >
                {/* 空分支已到货 → 入库登记 */}
                {(p.is_arrived as boolean) && !p.part_id && (
                  <Link
                    href={`/inventory/in?auto_fill=1&branch_id=${encodeURIComponent(p.id as string)}&part_number=${encodeURIComponent((p.part_number as string) || "")}&name=${encodeURIComponent((p.name as string) || p.part_names?.name || "")}&unit=${encodeURIComponent((p.unit as string) || "")}&brand=${encodeURIComponent((p.brand as string) || "")}&specification=${encodeURIComponent((p.specification as string) || "")}&unit_cost=${(p.unit_cost as number) || ""}&supplier=${encodeURIComponent((p.supplier_name as string) || "")}`}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 hover:bg-orange-100 inline-block"
                  >
                    入库登记
                  </Link>
                )}
                <div className="flex items-center flex-wrap gap-2">
                  <PartWorkflowActions
                    status={pStatus}
                    partName={partName}
                    workOrderItemPartId={p.id as string}
                    partId={p.part_id as string}
                    quantity={p.quantity as number}
                    pickedQty={pNetPicked}
                    returnQty={pReturnQty}
                    suppliers={suppliers}
                    logisticsCompanies={logisticsCompanies}
                    locked={isLocked}
                  />
                  {/* 待出库申领角标：师傅手机端申领的数量，库管看到后备货实领（实领自动核销） */}
                  {(申领ByPart[p.id as string] || 0) > 0 && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border bg-amber-50 text-amber-700 border-amber-200">
                      已申领×{申领ByPart[p.id as string]}
                    </span>
                  )}
                </div>
                <ShowCommission>
                  {(() => {
                    const revenue = ((p.quantity as number) || 0) * ((p.unit_price as number) || 0);
                    const cost = ((p.quantity as number) || 0) * ((p.unit_cost as number) || 0);
                    const comm = calculatePartCommission(p.parts, p.part_names, revenue, cost);
                    if (comm.sales === 0 && comm.repair === 0 && comm.picking === 0 && comm.diagnosis === 0 && comm.qc === 0) return null;
                    return (
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="text-gray-400">提成:</span>
                        {comm.sales > 0 && <span className="text-green-600 bg-green-50 px-1.5 py-0.5 rounded">销售 {comm.sales.toFixed(2)}元</span>}
                        {comm.repair > 0 && <span className="text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">维修 {comm.repair.toFixed(2)}元</span>}
                        {comm.picking > 0 && <span className="text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">领料 {comm.picking.toFixed(2)}元</span>}
                        {comm.diagnosis > 0 && <span className="text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">诊断 {comm.diagnosis.toFixed(2)}元</span>}
                        {comm.qc > 0 && <span className="text-pink-600 bg-pink-50 px-1.5 py-0.5 rounded">质检 {comm.qc.toFixed(2)}元</span>}
                      </div>
                    );
                  })()}
                </ShowCommission>
                {/* 物流信息 */}
                {(p.logistics_agreement as string) && (
                  <span className="text-gray-400 text-[10px]">物流公司: {p.logistics_agreement as string}</span>
                )}
                {/* 备注 */}
                {(p.notes as string) && <span className="text-gray-400 text-xs">{p.notes as string}</span>}
                {/* 配件分支图片 */}
                <PartBranchImages images={(imagesByPart[p.id as string] || []) as { id: string; storage_path: string }[]} />
              </PartBranchEditor>
            );
          })}
        </div>
      </div>
    </div>
  );
}
