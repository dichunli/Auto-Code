"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function MergeButton({ id, name, allNames }: { id: string; name: string; allNames: { id: string; name: string }[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [merging, setMerging] = useState(false);

  const candidates = allNames.filter((n) => n.id !== id);

  async function handleMerge() {
    if (!targetId) {
      alert("请选择要合并到的目标配件名称");
      return;
    }
    const targetName = candidates.find((n) => n.id === targetId)?.name;
    if (!confirm(`确定要将「${name}」合并到「${targetName}」吗？合并后「${name}」将被删除，所有关联数据将转移到「${targetName}」。`)) {
      return;
    }
    setMerging(true);

    // 1. 处理 part_name_brands（避免 UNIQUE 冲突）
    const { data: currentLinks } = await supabase
      .from("part_name_brands")
      .select("brand_id, usage_count")
      .eq("part_name_id", id);
    const { data: targetLinks } = await supabase
      .from("part_name_brands")
      .select("brand_id")
      .eq("part_name_id", targetId);
    const targetBrandIds = new Set((targetLinks || []).map((l) => l.brand_id));

    for (const link of currentLinks || []) {
      if (!targetBrandIds.has(link.brand_id)) {
        await supabase.from("part_name_brands").insert({
          part_name_id: targetId,
          brand_id: link.brand_id,
          usage_count: link.usage_count || 0,
        });
      }
    }
    await supabase.from("part_name_brands").delete().eq("part_name_id", id);

    // 2. 更新其他表的 part_name_id
    const tables = ["parts", "work_order_parts", "company_part_prices", "purchase_order_items"];
    for (const table of tables) {
      const { error } = await supabase.from(table).update({ part_name_id: targetId }).eq("part_name_id", id);
      if (error) {
        alert(`合并失败（${table}）: ${error.message}`);
        setMerging(false);
        return;
      }
    }

    // 3. 删除原配件名称
    const { error: delError } = await supabase.from("part_names").delete().eq("id", id);
    if (delError) {
      alert("合并失败（删除原名称）: " + delError.message);
      setMerging(false);
      return;
    }

    setOpen(false);
    setTargetId("");
    setMerging(false);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-sm text-orange-600 hover:text-orange-700 font-medium"
      >
        合并
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md">
            <h3 className="text-base font-semibold text-gray-900 mb-2">合并配件名称</h3>
            <p className="text-sm text-gray-500 mb-4">
              将「{name}」合并到以下目标，合并后原名称将被删除，所有关联数据将转移到目标名称。
            </p>

            <div className="space-y-2 mb-6 max-h-48 overflow-y-auto">
              {candidates.length === 0 && (
                <div className="text-sm text-gray-400">没有其他配件名称可供合并</div>
              )}
              {candidates.map((n) => (
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

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => { setOpen(false); setTargetId(""); }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleMerge}
                disabled={merging || !targetId}
                className="px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50"
              >
                {merging ? "合并中..." : "确认合并"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
