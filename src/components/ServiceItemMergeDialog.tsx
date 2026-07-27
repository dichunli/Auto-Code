"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useConfirm } from "./ConfirmDialog";

interface Props {
  open: boolean;
  selectedItems: { id: string; name: string; code: string | null }[];
  onClose: () => void;
  onSuccess: () => void;
}

export default function ServiceItemMergeDialog({ open, selectedItems, onClose, onSuccess }: Props) {
  const supabase = createClient();
  const { 请求确认, 确认弹窗 } = useConfirm();
  const [targetId, setTargetId] = useState<string>("");
  const [finalName, setFinalName] = useState("");
  const [mergeStrategy, setMergeStrategy] = useState<"keep_target" | "override">("keep_target");
  const [merging, setMerging] = useState(false);
  const [conflictInfo, setConflictInfo] = useState<string>("");

  useEffect(() => {
    if (open && selectedItems.length > 0) {
      setTargetId(selectedItems[0].id);
      setFinalName(selectedItems[0].name);
      setConflictInfo("");
    }
  }, [open, selectedItems]);

  useEffect(() => {
    const target = selectedItems.find((i) => i.id === targetId);
    if (target) {
      setFinalName(target.name);
    }
  }, [targetId, selectedItems]);

  async function checkConflicts() {
    const target = selectedItems.find((i) => i.id === targetId);
    if (!target) return;
    const sourceIds = selectedItems.filter((i) => i.id !== targetId).map((i) => i.id);
    if (sourceIds.length === 0) return;

    const [
      { data: targetPrices },
      { data: sourcePrices },
      { data: targetSpecials },
      { data: sourceSpecials },
      { data: targetCompanies },
      { data: sourceCompanies },
    ] = await Promise.all([
      supabase.from("service_item_prices").select("vehicle_model_id,group_key").eq("service_item_id", target.id),
      supabase.from("service_item_prices").select("vehicle_model_id,group_key").in("service_item_id", sourceIds),
      supabase.from("service_item_special_prices").select("company_id,customer_id,vehicle_id").eq("service_item_id", target.id),
      supabase.from("service_item_special_prices").select("company_id,customer_id,vehicle_id").in("service_item_id", sourceIds),
      supabase.from("company_service_prices").select("company_id").eq("service_item_id", target.id),
      supabase.from("company_service_prices").select("company_id").in("service_item_id", sourceIds),
    ]);

    const targetPriceKeys = new Set((targetPrices || []).map((p) => `${p.vehicle_model_id}:${p.group_key || ""}`));
    const priceConflicts = (sourcePrices || []).filter((p) => targetPriceKeys.has(`${p.vehicle_model_id}:${p.group_key || ""}`)).length;

    const targetSpecialKeys = new Set(
      (targetSpecials || []).map((p) => `${p.company_id || ""}:${p.customer_id || ""}:${p.vehicle_id || ""}`)
    );
    const specialConflicts = (sourceSpecials || []).filter((p) =>
      targetSpecialKeys.has(`${p.company_id || ""}:${p.customer_id || ""}:${p.vehicle_id || ""}`)
    ).length;

    const targetCompanyIds = new Set((targetCompanies || []).map((p) => p.company_id));
    const companyConflicts = (sourceCompanies || []).filter((p) => targetCompanyIds.has(p.company_id)).length;

    const parts: string[] = [];
    if (priceConflicts > 0) parts.push(`车型定价 ${priceConflicts} 条`);
    if (specialConflicts > 0) parts.push(`指定用户价格 ${specialConflicts} 条`);
    if (companyConflicts > 0) parts.push(`单位服务价格 ${companyConflicts} 条`);
    if (parts.length > 0) {
      setConflictInfo(`发现价格冲突：${parts.join("、")}`);
    } else {
      setConflictInfo("");
    }
  }

  useEffect(() => {
    if (open && targetId) {
      checkConflicts();
    }
  }, [open, targetId]);

  async function handleMerge() {
    if (!targetId) {
      alert("请选择要保留的维修项目");
      return;
    }
    if (!finalName.trim()) {
      alert("请输入合并后的名称");
      return;
    }

    const target = selectedItems.find((i) => i.id === targetId);
    if (!target) return;

    const otherItems = selectedItems.filter((i) => i.id !== targetId);
    const otherNames = otherItems.map((i) => `「${i.name}」`).join("、");

    const strategyText = mergeStrategy === "keep_target" ? "保留主项目价格" : "用被合并项目价格覆盖";
    const confirmMsg = `确定要将${otherNames}合并到「${target.name}」吗？\n\n合并后名称为：${finalName.trim()}\n价格冲突策略：${strategyText}\n\n所有关联数据将转移到保留项目，其他项目将被删除。`;
    if (!(await 请求确认(confirmMsg))) return;

    setMerging(true);

    /* 1. 更新主项目名称 */
    if (finalName.trim() !== target.name) {
      const { error: nameErr } = await supabase
        .from("service_items")
        .update({ name: finalName.trim() })
        .eq("id", target.id);
      if (nameErr) {
        alert("更新合并后名称失败: " + nameErr.message);
        setMerging(false);
        return;
      }
    }

    /* 2. 逐个处理被合并项目 */
    for (const source of otherItems) {
      /* 2a. 迁移车型定价 */
      const { data: sourcePrices } = await supabase
        .from("service_item_prices")
        .select("vehicle_model_id,price,vip_price,customer_parts_price,company_price,group_key")
        .eq("service_item_id", source.id);

      if (sourcePrices && sourcePrices.length > 0) {
        const { data: targetPrices } = await supabase
          .from("service_item_prices")
          .select("vehicle_model_id,group_key")
          .eq("service_item_id", target.id);
        const targetPriceKeys = new Set(
          (targetPrices || []).map((p) => `${p.vehicle_model_id}:${p.group_key || ""}`)
        );

        for (const price of sourcePrices) {
          const key = `${price.vehicle_model_id}:${price.group_key || ""}`;
          const hasConflict = targetPriceKeys.has(key);

          if (!hasConflict) {
            /* 无冲突，直接插入 */
            await supabase.from("service_item_prices").insert({
              service_item_id: target.id,
              vehicle_model_id: price.vehicle_model_id,
              price: price.price,
              vip_price: price.vip_price,
              customer_parts_price: price.customer_parts_price,
              company_price: price.company_price,
              group_key: price.group_key || null,
            });
            targetPriceKeys.add(key);
          } else if (mergeStrategy === "override") {
            /* 有冲突且选择覆盖 */
            await supabase
              .from("service_item_prices")
              .update({
                price: price.price,
                vip_price: price.vip_price,
                customer_parts_price: price.customer_parts_price,
                company_price: price.company_price,
              })
              .eq("service_item_id", target.id)
              .eq("vehicle_model_id", price.vehicle_model_id)
              .eq("group_key", price.group_key || null);
          }
          /* 有冲突且选择保留主项目价格：跳过 */
        }
      }

      /* 2b. 迁移指定用户价格 */
      const { data: sourceSpecialPrices } = await supabase
        .from("service_item_special_prices")
        .select("company_id,customer_id,vehicle_id,price")
        .eq("service_item_id", source.id);

      if (sourceSpecialPrices && sourceSpecialPrices.length > 0) {
        const { data: targetSpecialPrices } = await supabase
          .from("service_item_special_prices")
          .select("company_id,customer_id,vehicle_id")
          .eq("service_item_id", target.id);
        const targetSpecialKeys = new Set(
          (targetSpecialPrices || []).map(
            (p) => `${p.company_id || ""}:${p.customer_id || ""}:${p.vehicle_id || ""}`
          )
        );

        for (const sp of sourceSpecialPrices) {
          const key = `${sp.company_id || ""}:${sp.customer_id || ""}:${sp.vehicle_id || ""}`;
          const hasConflict = targetSpecialKeys.has(key);

          if (!hasConflict) {
            await supabase.from("service_item_special_prices").insert({
              service_item_id: target.id,
              company_id: sp.company_id,
              customer_id: sp.customer_id,
              vehicle_id: sp.vehicle_id,
              price: sp.price,
            });
            targetSpecialKeys.add(key);
          } else if (mergeStrategy === "override") {
            await supabase
              .from("service_item_special_prices")
              .update({ price: sp.price })
              .eq("service_item_id", target.id)
              .eq("company_id", sp.company_id || null)
              .eq("customer_id", sp.customer_id || null)
              .eq("vehicle_id", sp.vehicle_id || null);
          }
        }
      }

      /* 2c. 迁移单位服务价格 */
      const { data: sourceCompanyPrices } = await supabase
        .from("company_service_prices")
        .select("company_id,price")
        .eq("service_item_id", source.id);

      if (sourceCompanyPrices && sourceCompanyPrices.length > 0) {
        const { data: targetCompanyPrices } = await supabase
          .from("company_service_prices")
          .select("company_id")
          .eq("service_item_id", target.id);
        const targetCompanyIds = new Set((targetCompanyPrices || []).map((p) => p.company_id));

        for (const cp of sourceCompanyPrices) {
          const hasConflict = targetCompanyIds.has(cp.company_id);

          if (!hasConflict) {
            await supabase.from("company_service_prices").insert({
              service_item_id: target.id,
              company_id: cp.company_id,
              price: cp.price,
            });
            targetCompanyIds.add(cp.company_id);
          } else if (mergeStrategy === "override") {
            await supabase
              .from("company_service_prices")
              .update({ price: cp.price })
              .eq("service_item_id", target.id)
              .eq("company_id", cp.company_id);
          }
        }
      }

      /* 2d. 更新引用表 */
      const refTables = [
        "work_order_items",
        "vehicle_maintenance_template_items",
        "knowledge_service_links",
        "outsource_order_items",
      ];
      for (const table of refTables) {
        const { error } = await supabase
          .from(table)
          .update({ service_item_id: target.id })
          .eq("service_item_id", source.id);
        if (error) {
          console.error(`更新 ${table} 失败:`, error);
        }
      }

      /* 2e. 删除被合并项目（ON DELETE CASCADE 会自动清理关联的定价表） */
      const { error: delError } = await supabase.from("service_items").delete().eq("id", source.id);
      if (delError) {
        alert(`删除「${source.name}」失败: ${delError.message}`);
        setMerging(false);
        return;
      }
    }

    setMerging(false);
    alert("合并成功");
    onSuccess();
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md mx-4">
        <h3 className="text-base font-semibold text-gray-900 mb-2">合并维修项目</h3>
        <p className="text-sm text-gray-500 mb-4">
          请选择要保留的维修项目，其他选中的项目将被删除，所有关联数据将转移到保留项。
        </p>

        {/* 保留项目选择 */}
        <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
          {selectedItems.map((item) => (
            <label
              key={item.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                targetId === item.id
                  ? "border-blue-300 bg-blue-50"
                  : "border-gray-200 hover:bg-gray-50"
              }`}
            >
              <input
                type="radio"
                name="mergeTarget"
                value={item.id}
                checked={targetId === item.id}
                onChange={() => setTargetId(item.id)}
                className="text-blue-600"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-900 truncate">{item.name}</div>
                {item.code && <div className="text-xs text-gray-400">{item.code}</div>}
              </div>
            </label>
          ))}
        </div>

        {/* 合并后名称 */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">合并后的名称</label>
          <input
            type="text"
            value={finalName}
            onChange={(e) => setFinalName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="请输入合并后的名称"
          />
        </div>

        {/* 冲突策略 */}
        {conflictInfo && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="text-sm text-yellow-800 mb-2">{conflictInfo}</div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mergeStrategy"
                  value="keep_target"
                  checked={mergeStrategy === "keep_target"}
                  onChange={() => setMergeStrategy("keep_target")}
                  className="text-blue-600"
                />
                <span className="text-sm text-gray-700">保留主项目价格（被合并的冲突价格忽略）</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mergeStrategy"
                  value="override"
                  checked={mergeStrategy === "override"}
                  onChange={() => setMergeStrategy("override")}
                  className="text-blue-600"
                />
                <span className="text-sm text-gray-700">用被合并项目价格覆盖主项目价格</span>
              </label>
            </div>
          </div>
        )}

        {/* 按钮 */}
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleMerge}
            disabled={merging || !targetId || !finalName.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50"
          >
            {merging ? "合并中..." : "确认合并"}
          </button>
        </div>
      </div>

      {确认弹窗}
    </div>
  );
}
