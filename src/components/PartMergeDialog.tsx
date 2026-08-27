"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useConfirm } from "./ConfirmDialog";
import { 合并配件 } from "@/app/parts/actions";

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

    /* 合并走 Server Action + RPC merge_parts 一个事务：
     * 11 张表迁移 + 删除源配件要么全成要么全败，数量在服务端读最新值累加 */
    const result = await 合并配件({
      targetId,
      sourceIds: otherItems.map((i) => i.id),
      name: finalName,
      partNumber: finalPartNumber,
      mergeQuantity,
    });
    setMerging(false);
    if (!result.success) {
      alert("合并失败: " + (result.error || "未知错误"));
      return;
    }

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
