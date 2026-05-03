"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Props {
  open: boolean;
  selectedNames: { id: string; name: string }[];
  onClose: () => void;
  onSuccess: () => void;
}

export function BatchMergeDialog({ open, selectedNames, onClose, onSuccess }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [targetId, setTargetId] = useState<string>("");
  const [finalName, setFinalName] = useState("");
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    if (open && selectedNames.length > 0) {
      setTargetId(selectedNames[0].id);
      setFinalName(selectedNames[0].name);
    }
  }, [open, selectedNames]);

  useEffect(() => {
    const target = selectedNames.find((n) => n.id === targetId);
    if (target) {
      setFinalName(target.name);
    }
  }, [targetId, selectedNames]);

  async function handleMerge() {
    if (!targetId) {
      alert("请选择要保留的配件名称");
      return;
    }
    if (!finalName.trim()) {
      alert("请输入合并后的名称");
      return;
    }

    const targetName = selectedNames.find((n) => n.id === targetId)?.name;
    const otherNames = selectedNames
      .filter((n) => n.id !== targetId)
      .map((n) => n.name)
      .join("」、「");

    if (
      !confirm(
        `确定要将「${otherNames}」合并到「${targetName}」吗？\n\n合并后名称为：${finalName.trim()}\n\n所有关联数据将转移到保留项，其他项将被删除。`
      )
    ) {
      return;
    }

    setMerging(true);

    // 1. 如果最终名称与目标不同，更新目标名称
    if (finalName.trim() !== targetName) {
      const { error: updateNameError } = await supabase
        .from("part_names")
        .update({ name: finalName.trim() })
        .eq("id", targetId);
      if (updateNameError) {
        alert("更新合并后名称失败: " + updateNameError.message);
        setMerging(false);
        return;
      }
    }

    // 2. 对每个非目标选中的配件进行合并
    for (const source of selectedNames) {
      if (source.id === targetId) continue;

      // 2a. 处理 part_name_brands（避免 UNIQUE 冲突）
      const { data: currentBrandLinks } = await supabase
        .from("part_name_brands")
        .select("brand_id, usage_count")
        .eq("part_name_id", source.id);
      const { data: targetBrandLinks } = await supabase
        .from("part_name_brands")
        .select("brand_id")
        .eq("part_name_id", targetId);
      const targetBrandIds = new Set((targetBrandLinks || []).map((l) => l.brand_id));

      for (const link of currentBrandLinks || []) {
        if (!targetBrandIds.has(link.brand_id)) {
          await supabase.from("part_name_brands").insert({
            part_name_id: targetId,
            brand_id: link.brand_id,
            usage_count: link.usage_count || 0,
          });
        }
      }
      await supabase.from("part_name_brands").delete().eq("part_name_id", source.id);

      // 2b. 处理 part_name_specifications（避免 UNIQUE 冲突）
      const { data: currentSpecLinks } = await supabase
        .from("part_name_specifications")
        .select("specification_id, usage_count")
        .eq("part_name_id", source.id);
      const { data: targetSpecLinks } = await supabase
        .from("part_name_specifications")
        .select("specification_id")
        .eq("part_name_id", targetId);
      const targetSpecIds = new Set((targetSpecLinks || []).map((l) => l.specification_id));

      for (const link of currentSpecLinks || []) {
        if (!targetSpecIds.has(link.specification_id)) {
          await supabase.from("part_name_specifications").insert({
            part_name_id: targetId,
            specification_id: link.specification_id,
            usage_count: link.usage_count || 0,
          });
        }
      }
      await supabase.from("part_name_specifications").delete().eq("part_name_id", source.id);

      // 2c. 更新其他表的 part_name_id
      const tables = ["parts", "work_order_parts", "company_part_prices", "purchase_order_items"];
      for (const table of tables) {
        const { error } = await supabase
          .from(table)
          .update({ part_name_id: targetId })
          .eq("part_name_id", source.id);
        if (error) {
          alert(`合并失败（${table}）: ${error.message}`);
          setMerging(false);
          return;
        }
      }

      // 2d. 删除原配件名称
      const { error: delError } = await supabase.from("part_names").delete().eq("id", source.id);
      if (delError) {
        alert("合并失败（删除原名称）: " + delError.message);
        setMerging(false);
        return;
      }
    }

    setMerging(false);
    onSuccess();
    router.refresh();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md">
        <h3 className="text-base font-semibold text-gray-900 mb-2">合并配件名称</h3>
        <p className="text-sm text-gray-500 mb-4">
          请选择要保留的配件名称，并确认合并后的最终名称。其他选中的配件将被删除，所有关联数据将转移到保留项。
        </p>

        <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
          {selectedNames.map((n) => (
            <label
              key={n.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                targetId === n.id
                  ? "border-blue-300 bg-blue-50"
                  : "border-gray-200 hover:bg-gray-50"
              }`}
            >
              <input
                type="radio"
                name="mergeTarget"
                value={n.id}
                checked={targetId === n.id}
                onChange={() => setTargetId(n.id)}
                className="text-blue-600"
              />
              <span className="text-sm text-gray-900">{n.name}</span>
            </label>
          ))}
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">合并后的名称</label>
          <input
            type="text"
            value={finalName}
            onChange={(e) => setFinalName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="请输入合并后的名称"
          />
        </div>

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
    </div>
  );
}
