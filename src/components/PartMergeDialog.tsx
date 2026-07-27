"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useConfirm } from "./ConfirmDialog";

interface Props {
  open: boolean;
  selectedItems: { id: string; name: string; part_number: string | null; quantity: number }[];
  onClose: () => void;
  onSuccess: () => void;
}

export default function PartMergeDialog({ open, selectedItems, onClose, onSuccess }: Props) {
  const supabase = createClient();
  const { 请求确认, 确认弹窗 } = useConfirm();
  const [targetId, setTargetId] = useState<string>("");
  const [finalName, setFinalName] = useState("");
  const [finalPartNumber, setFinalPartNumber] = useState("");
  const [mergeQuantity, setMergeQuantity] = useState(true);
  const [merging, setMerging] = useState(false);
  const [conflictInfo, setConflictInfo] = useState<string>("");

  useEffect(() => {
    if (open && selectedItems.length > 0) {
      setTargetId(selectedItems[0].id);
      setFinalName(selectedItems[0].name);
      setFinalPartNumber(selectedItems[0].part_number || "");
      setConflictInfo("");
    }
  }, [open, selectedItems]);

  useEffect(() => {
    const target = selectedItems.find((i) => i.id === targetId);
    if (target) {
      setFinalName(target.name);
      setFinalPartNumber(target.part_number || "");
    }
  }, [targetId, selectedItems]);

  async function checkConflicts() {
    const target = selectedItems.find((i) => i.id === targetId);
    if (!target) return;
    const sourceIds = selectedItems.filter((i) => i.id !== targetId).map((i) => i.id);
    if (sourceIds.length === 0) return;

    const [
      { data: targetVehicles },
      { data: sourceVehicles },
      { data: targetCompanies },
      { data: sourceCompanies },
    ] = await Promise.all([
      supabase.from("part_vehicle_models").select("vehicle_model_id").eq("part_id", target.id),
      supabase.from("part_vehicle_models").select("vehicle_model_id").in("part_id", sourceIds),
      supabase.from("company_part_prices").select("company_id").eq("part_id", target.id),
      supabase.from("company_part_prices").select("company_id").in("part_id", sourceIds),
    ]);

    const targetVehicleIds = new Set((targetVehicles || []).map((v) => v.vehicle_model_id));
    const vehicleConflicts = (sourceVehicles || []).filter((v) => targetVehicleIds.has(v.vehicle_model_id)).length;

    const targetCompanyIds = new Set((targetCompanies || []).map((c) => c.company_id));
    const companyConflicts = (sourceCompanies || []).filter((c) => targetCompanyIds.has(c.company_id)).length;

    const parts: string[] = [];
    if (vehicleConflicts > 0) parts.push(`车型关联 ${vehicleConflicts} 条`);
    if (companyConflicts > 0) parts.push(`单位专属价格 ${companyConflicts} 条`);
    if (parts.length > 0) {
      setConflictInfo(`发现冲突（将被忽略）：${parts.join("、")}`);
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
      alert("请选择要保留的配件");
      return;
    }
    if (!finalName.trim()) {
      alert("请输入合并后的名称");
      return;
    }
    if (!finalPartNumber.trim()) {
      alert("请输入合并后的配件编号");
      return;
    }

    const target = selectedItems.find((i) => i.id === targetId);
    if (!target) return;

    const otherItems = selectedItems.filter((i) => i.id !== targetId);
    const otherNames = otherItems.map((i) => `「${i.name}」`).join("、");

    const confirmMsg = `确定要将${otherNames}合并到「${target.name}」吗？\n\n合并后：\n名称：${finalName.trim()}\n编号：${finalPartNumber.trim()}\n${mergeQuantity ? "库存数量将累加" : "库存数量保留主配件"}\n\n所有关联数据将转移到保留配件，其他配件将被删除。`;
    if (!(await 请求确认(confirmMsg))) return;

    setMerging(true);

    /* 1. 更新主配件名称、编号 */
    const updateData: Record<string, unknown> = {
      name: finalName.trim(),
      part_number: finalPartNumber.trim(),
    };
    if (mergeQuantity) {
      const totalQty = selectedItems.reduce((sum, i) => sum + i.quantity, 0);
      updateData.quantity = totalQty;
    }

    const { error: nameErr } = await supabase
      .from("parts")
      .update(updateData)
      .eq("id", target.id);
    if (nameErr) {
      alert("更新主配件信息失败: " + nameErr.message);
      setMerging(false);
      return;
    }

    /* 2. 逐个处理被合并配件 */
    for (const source of otherItems) {
      const sourceIds = [source.id];

      /* 2a. 迁移车型关联（跳过冲突） */
      const { data: sourceVehicles } = await supabase
        .from("part_vehicle_models")
        .select("vehicle_model_id, fitment_position, source, vin17_fitness_id")
        .eq("part_id", source.id);

      if (sourceVehicles && sourceVehicles.length > 0) {
        const { data: targetVehicles } = await supabase
          .from("part_vehicle_models")
          .select("vehicle_model_id")
          .eq("part_id", target.id);
        const targetVehicleIds = new Set((targetVehicles || []).map((v) => v.vehicle_model_id));

        for (const v of sourceVehicles) {
          if (!targetVehicleIds.has(v.vehicle_model_id)) {
            await supabase.from("part_vehicle_models").insert({
              part_id: target.id,
              vehicle_model_id: v.vehicle_model_id,
              fitment_position: v.fitment_position,
              source: v.source,
              vin17_fitness_id: v.vin17_fitness_id,
            });
            targetVehicleIds.add(v.vehicle_model_id);
          }
        }
      }

      /* 2b. 迁移单位专属价格（跳过冲突） */
      const { data: sourcePrices } = await supabase
        .from("company_part_prices")
        .select("company_id, price")
        .eq("part_id", source.id);

      if (sourcePrices && sourcePrices.length > 0) {
        const { data: targetPrices } = await supabase
          .from("company_part_prices")
          .select("company_id")
          .eq("part_id", target.id);
        const targetCompanyIds = new Set((targetPrices || []).map((p) => p.company_id));

        for (const p of sourcePrices) {
          if (!targetCompanyIds.has(p.company_id)) {
            await supabase.from("company_part_prices").insert({
              part_id: target.id,
              company_id: p.company_id,
              price: p.price,
            });
            targetCompanyIds.add(p.company_id);
          }
        }
      }

      /* 2c. 迁移库存批次 */
      const { error: batchErr } = await supabase
        .from("part_batches")
        .update({ part_id: target.id })
        .eq("part_id", source.id);
      if (batchErr) {
        console.error("迁移批次失败:", batchErr);
      }

      /* 2d. 迁移库存日志 */
      const { error: logErr } = await supabase
        .from("inventory_logs")
        .update({ part_id: target.id })
        .eq("part_id", source.id);
      if (logErr) {
        console.error("迁移库存日志失败:", logErr);
      }

      /* 2e. 迁移盘点明细 */
      const { error: checkErr } = await supabase
        .from("inventory_check_items")
        .update({ part_id: target.id })
        .eq("part_id", source.id);
      if (checkErr) {
        console.error("迁移盘点记录失败:", checkErr);
      }

      /* 2f. 迁移退货单 */
      const { error: returnErr } = await supabase
        .from("purchase_returns")
        .update({ part_id: target.id })
        .eq("part_id", source.id);
      if (returnErr) {
        console.error("迁移退货记录失败:", returnErr);
      }

      /* 2g. 迁移采购订单 */
      const { error: orderErr } = await supabase
        .from("purchase_order_items")
        .update({ part_id: target.id })
        .eq("part_id", source.id);
      if (orderErr) {
        console.error("迁移采购记录失败:", orderErr);
      }

      /* 2h. 迁移工单配件引用 */
      const { error: woErr } = await supabase
        .from("work_order_item_parts")
        .update({ part_id: target.id })
        .eq("part_id", source.id);
      if (woErr) {
        console.error("迁移工单配件失败:", woErr);
      }

      /* 2i. 迁移保养模板配件 */
      const { error: tmplErr } = await supabase
        .from("vehicle_maintenance_template_parts")
        .update({ part_id: target.id })
        .eq("part_id", source.id);
      if (tmplErr) {
        console.error("迁移模板配件失败:", tmplErr);
      }

      /* 2j. 迁移配件图片 */
      const { error: imgErr } = await supabase
        .from("part_images")
        .update({ part_id: target.id })
        .eq("part_id", source.id);
      if (imgErr) {
        console.error("迁移图片失败:", imgErr);
      }

      /* 2k. 删除被合并配件 */
      const { error: delError } = await supabase.from("parts").delete().eq("id", source.id);
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
        <h3 className="text-base font-semibold text-gray-900 mb-2">合并配件</h3>
        <p className="text-sm text-gray-500 mb-4">
          请选择要保留的配件，其他选中的配件将被删除，所有关联数据将转移到保留项。
        </p>

        {/* 保留配件选择 */}
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
                {item.part_number && <div className="text-xs text-gray-400">{item.part_number} · 库存{item.quantity}</div>}
              </div>
            </label>
          ))}
        </div>

        {/* 合并后名称 */}
        <div className="mb-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">合并后的名称</label>
          <input
            type="text"
            value={finalName}
            onChange={(e) => setFinalName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="请输入合并后的名称"
          />
        </div>

        {/* 合并后编号 */}
        <div className="mb-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">合并后的配件编号</label>
          <input
            type="text"
            value={finalPartNumber}
            onChange={(e) => setFinalPartNumber(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="请输入合并后的配件编号"
          />
        </div>

        {/* 库存累加选项 */}
        <div className="mb-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={mergeQuantity}
              onChange={(e) => setMergeQuantity(e.target.checked)}
              className="rounded border-gray-300 text-blue-600"
            />
            <span className="text-sm text-gray-700">累加所有配件的库存数量</span>
          </label>
        </div>

        {/* 冲突提示 */}
        {conflictInfo && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="text-sm text-yellow-800">{conflictInfo}</div>
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
            disabled={merging || !targetId || !finalName.trim() || !finalPartNumber.trim()}
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
