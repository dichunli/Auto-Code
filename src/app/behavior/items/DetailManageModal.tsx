"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { ImageUploader } from "@/components/ImageUploader";
import { useConfirm } from "@/components/ConfirmDialog";

/* 检查细节编辑行：真实行用数据库 id，新增行用 new-序号 临时 id */
interface 细节行 {
  id: string;
  name: string;
  description: string;
  score_value: string;
  guide_images: string[];
  isNew: boolean;
}

interface Props {
  itemId: string;
  itemName: string;
  onClose: () => void;
  /* 保存成功后通知父组件刷新细节条数 */
  onSaved: () => void;
}

/* 检查细节管理弹窗：一个项目（场地）下的逐条检查点，每条有图文说明和分值。
 * 本地编辑后点"保存"统一提交（新增 insert / 修改 update / 删除 delete） */
export default function DetailManageModal({ itemId, itemName, onClose, onSaved }: Props) {
  const supabase = createClient();
  const { 请求确认, 确认弹窗 } = useConfirm();
  const [details, setDetails] = useState<细节行[]>([]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newCounter, setNewCounter] = useState(0);

  const fetchDetails = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("behavior_item_details")
      .select("*")
      .eq("item_id", itemId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    const rows: 细节行[] = (data || []).map((d: { id: string; name: string; description: string | null; score_value: number; guide_images: string[] | null }) => ({
      id: d.id,
      name: d.name,
      description: d.description || "",
      score_value: String(d.score_value),
      guide_images: d.guide_images || [],
      isNew: false,
    }));
    setDetails(rows);
    setLoading(false);
  }, [supabase, itemId]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  function addRow() {
    const id = `new-${newCounter}`;
    setNewCounter(newCounter + 1);
    setDetails([...details, { id, name: "", description: "", score_value: "1", guide_images: [], isNew: true }]);
  }

  function updateRow(id: string, patch: Partial<细节行>) {
    setDetails(details.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function removeRow(id: string) {
    const row = details.find((d) => d.id === id);
    if (row && !row.isNew) {
      setDeletedIds([...deletedIds, id]);
    }
    setDetails(details.filter((d) => d.id !== id));
  }

  async function handleSave() {
    for (const d of details) {
      if (!d.name.trim()) {
        alert("每条细节都要填名称");
        return;
      }
      const v = parseInt(d.score_value);
      if (!v || v <= 0) {
        alert(`细节「${d.name}」的分值要大于 0`);
        return;
      }
    }

    setSaving(true);
    try {
      /* 1. 删除 */
      if (deletedIds.length > 0) {
        const { error } = await supabase.from("behavior_item_details").delete().in("id", deletedIds);
        if (error) throw error;
      }

      /* 2. 新增与修改（sort_order 按当前排列顺序落库） */
      for (let i = 0; i < details.length; i++) {
        const d = details[i];
        const payload = {
          item_id: itemId,
          name: d.name.trim(),
          description: d.description.trim() || null,
          score_value: parseInt(d.score_value),
          guide_images: d.guide_images,
          sort_order: i,
        };
        if (d.isNew) {
          const { error } = await supabase.from("behavior_item_details").insert(payload);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("behavior_item_details").update(payload).eq("id", d.id);
          if (error) throw error;
        }
      }

      onSaved();
      onClose();
    } catch (err: unknown) {
      alert("保存失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  async function handleClose() {
    if (details.some((d) => d.isNew) || deletedIds.length > 0) {
      if (!(await 请求确认("有未保存的改动，确定关闭吗？"))) return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-2xl max-h-[85vh] flex flex-col">
        <h3 className="text-base font-semibold text-gray-900 mb-1">检查细节</h3>
        <p className="text-xs text-gray-500 mb-4">项目：{itemName}。每条细节检查时单独打分，多条合计为本次总分。</p>

        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {loading ? (
            <p className="p-6 text-center text-sm text-gray-400">加载中...</p>
          ) : details.length === 0 ? (
            <p className="p-6 text-center text-sm text-gray-400">还没有检查细节，点击下方按钮添加</p>
          ) : (
            details.map((d, index) => (
              <div key={d.id} className="border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-6">#{index + 1}</span>
                  <input
                    value={d.name}
                    onChange={(e) => updateRow(d.id, { name: e.target.value })}
                    className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm"
                    placeholder="细节名称，如：地面无油污"
                  />
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={d.score_value}
                      onChange={(e) => updateRow(d.id, { score_value: e.target.value })}
                      className="w-16 px-2 py-1.5 border border-gray-300 rounded text-sm text-center"
                      min="1"
                    />
                    <span className="text-xs text-gray-500">分</span>
                  </div>
                  <button
                    onClick={() => removeRow(d.id)}
                    className="text-xs px-2 py-1 text-red-600 border border-red-200 rounded hover:bg-red-50"
                  >
                    删除
                  </button>
                </div>
                <textarea
                  value={d.description}
                  onChange={(e) => updateRow(d.id, { description: e.target.value })}
                  rows={2}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                  placeholder="检查标准说明，如：地面无油渍、无水迹、无杂物堆放..."
                />
                <ImageUploader
                  existingImages={d.guide_images}
                  maxImages={3}
                  folder="behavior"
                  onUpload={(paths) => updateRow(d.id, { guide_images: paths })}
                />
              </div>
            ))
          )}
        </div>

        <div className="pt-3">
          <button
            onClick={addRow}
            className="w-full py-2 text-sm text-blue-600 border border-dashed border-blue-300 rounded-lg hover:bg-blue-50"
          >
            + 添加细节
          </button>
        </div>

        <div className="flex gap-3 justify-end pt-4 mt-2 border-t border-gray-100">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            关闭
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
      {确认弹窗}
    </div>
  );
}
