"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { filterLogisticsBySupplierName, supplierNeedsLogistics } from "@/lib/logisticsFilter";

interface BatchEditModalProps {
  orderId: string;
  items: any[];
  itemParts: any[];
  suppliers: any[];
  logisticsCompanies: any[];
  onClose: () => void;
  onSuccess: () => void;
}

export function BatchEditModal({ orderId, items, itemParts, suppliers, logisticsCompanies, onClose, onSuccess }: BatchEditModalProps) {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);

  // 构建可选项：项目 + 分支
  const options: { id: string; type: "item" | "part"; label: string; parentLabel?: string }[] = [];
  items?.forEach((item: any) => {
    options.push({ id: item.id, type: "item", label: `${item.name} (${item.item_type === "labor" ? "工时" : item.item_type === "part" ? "配件" : "其他"})` });
    const parts = itemParts?.filter((p: any) => p.work_order_item_id === item.id) || [];
    parts.forEach((p: any) => {
      options.push({
        id: p.id,
        type: "part",
        label: `  └ ${p.parts?.name || p.name || p.part_names?.name || "未命名配件"}`,
        parentLabel: item.name,
      });
    });
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchValues, setBatchValues] = useState({
    customer_opinion: "",
    is_purchased: "",
    is_arrived: "",
    supplier_name: "",
    logistics_agreement: "",
    business_type: "",
    alias_name: "",
  });

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  function toggleAll() {
    if (selectedIds.size === options.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(options.map((o) => o.id)));
    }
  }

  async function handleSubmit() {
    if (selectedIds.size === 0) {
      alert("请至少选择一项");
      return;
    }
    setLoading(true);

    try {
      const selectedItems = Array.from(selectedIds).filter((id) => options.find((o) => o.id === id)?.type === "item");
      const selectedParts = Array.from(selectedIds).filter((id) => options.find((o) => o.id === id)?.type === "part");

      // 批量更新项目
      if (selectedItems.length > 0) {
        const itemUpdates: any = {};
        if (batchValues.customer_opinion) itemUpdates.customer_opinion = batchValues.customer_opinion;
        if (batchValues.business_type) itemUpdates.business_type = batchValues.business_type;
        if (batchValues.alias_name) itemUpdates.alias_name = batchValues.alias_name;
        if (Object.keys(itemUpdates).length > 0) {
          const { error } = await supabase.from("work_order_items").update(itemUpdates).in("id", selectedItems);
          if (error) throw error;
        }
      }

      // 批量更新分支
      if (selectedParts.length > 0) {
        const partUpdates: any = {};
        if (batchValues.customer_opinion) partUpdates.customer_opinion = batchValues.customer_opinion;
        if (batchValues.is_purchased !== "") partUpdates.is_purchased = batchValues.is_purchased === "true";
        if (batchValues.is_arrived !== "") partUpdates.is_arrived = batchValues.is_arrived === "true";
        if (batchValues.supplier_name) partUpdates.supplier_name = batchValues.supplier_name;
        if (batchValues.logistics_agreement) partUpdates.logistics_agreement = batchValues.logistics_agreement;
        if (batchValues.alias_name) partUpdates.alias_name = batchValues.alias_name;

        if (Object.keys(partUpdates).length > 0) {
          const { error } = await supabase.from("work_order_item_parts").update(partUpdates).in("id", selectedParts);
          if (error) throw error;
        }
      }

      onSuccess();
    } catch (err: any) {
      alert("批量更新失败: " + err.message);
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[85vh] flex flex-col">
        <h3 className="text-base font-semibold text-gray-900 mb-4">批量修改</h3>

        <div className="flex-1 overflow-hidden flex gap-4 min-h-0">
          {/* 左侧选择列表 */}
          <div className="flex-1 border border-gray-200 rounded-lg overflow-hidden flex flex-col">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
              <input type="checkbox" checked={selectedIds.size === options.length && options.length > 0} onChange={toggleAll} />
              <span className="text-xs text-gray-500">全选 ({selectedIds.size}/{options.length})</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {options.map((opt) => (
                <label key={opt.id} className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer hover:bg-gray-50 ${opt.type === "part" ? "text-gray-500" : "text-gray-900 font-medium"}`}>
                  <input type="checkbox" checked={selectedIds.has(opt.id)} onChange={() => toggleSelect(opt.id)} />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 右侧批量操作 */}
          <div className="w-64 space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">客户意见</label>
              <select className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" value={batchValues.customer_opinion} onChange={(e) => setBatchValues({ ...batchValues, customer_opinion: e.target.value })}>
                <option value="">不修改</option>
                <option value="pending">待确认</option>
                <option value="agree">同意</option>
                <option value="reject">拒绝</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">采购状态</label>
              <select className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" value={batchValues.is_purchased} onChange={(e) => setBatchValues({ ...batchValues, is_purchased: e.target.value })}>
                <option value="">不修改</option>
                <option value="true">已采购</option>
                <option value="false">未采购</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">到货状态</label>
              <select className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" value={batchValues.is_arrived} onChange={(e) => setBatchValues({ ...batchValues, is_arrived: e.target.value })}>
                <option value="">不修改</option>
                <option value="true">已到货</option>
                <option value="false">未到货</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">供应商</label>
              <select className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" value={batchValues.supplier_name} onChange={(e) => setBatchValues({ ...batchValues, supplier_name: e.target.value })}>
                <option value="">不修改</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>
            {(() => {
              const selectedSupplier = suppliers.find((s) => s.name === batchValues.supplier_name);
              const region = selectedSupplier?.region as ("local" | "harbin" | "outside" | undefined);
              if (selectedSupplier && !supplierNeedsLogistics(region)) {
                return (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">物流公司</label>
                    <div className="w-full px-2 py-1.5 text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded">本地供应商，无需物流</div>
                  </div>
                );
              }
              const filtered = filterLogisticsBySupplierName(logisticsCompanies, batchValues.supplier_name, suppliers);
              return (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    物流公司
                    {region === "harbin" && <span className="ml-1 text-blue-500">（哈市）</span>}
                    {region === "outside" && <span className="ml-1 text-orange-500">（外阜）</span>}
                  </label>
                  <select className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" value={batchValues.logistics_agreement} onChange={(e) => setBatchValues({ ...batchValues, logistics_agreement: e.target.value })}>
                    <option value="">不修改</option>
                    {filtered.map((lc) => (
                      <option key={lc.id} value={lc.name}>{lc.name}</option>
                    ))}
                  </select>
                </div>
              );
            })()}
            <div>
              <label className="block text-xs text-gray-500 mb-1">业务类型</label>
              <select className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" value={batchValues.business_type} onChange={(e) => setBatchValues({ ...batchValues, business_type: e.target.value })}>
                <option value="">不修改</option>
                <option value="normal">正常工单</option>
                <option value="insurance">保险业务</option>
                <option value="gift">赠送项目</option>
                <option value="rework">返工项目</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">别名</label>
              <input
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                placeholder="不修改"
                value={batchValues.alias_name}
                onChange={(e) => setBatchValues({ ...batchValues, alias_name: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex gap-3 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            取消
          </button>
          <button type="button" onClick={handleSubmit} disabled={loading} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {loading ? "更新中..." : `确认更新 (${selectedIds.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}
