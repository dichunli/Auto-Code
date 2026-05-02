"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

interface Props {
  open: boolean;
  selectedSpecIds: string[];
  onClose: () => void;
  onSuccess: () => void;
}

export function BatchLinkDialog({ open, selectedSpecIds, onClose, onSuccess }: Props) {
  const supabase = createClient();
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [partNames, setPartNames] = useState<any[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [loadingParts, setLoadingParts] = useState(false);
  const [linking, setLinking] = useState(false);
  const [resultText, setResultText] = useState("");

  useEffect(() => {
    if (!open) {
      setSelectedCategoryId("");
      setPartNames([]);
      setResultText("");
      return;
    }
    setLoadingCategories(true);
    supabase.from("part_categories").select("id, name").order("name").then(({ data }) => {
      setCategories(data || []);
      setLoadingCategories(false);
    });
  }, [open, supabase]);

  useEffect(() => {
    if (!selectedCategoryId) {
      setPartNames([]);
      return;
    }
    setLoadingParts(true);
    supabase.from("part_names").select("id, name").eq("category_id", selectedCategoryId).order("name").then(({ data }) => {
      setPartNames(data || []);
      setLoadingParts(false);
    });
  }, [selectedCategoryId, supabase]);

  async function handleLink() {
    if (!selectedCategoryId || partNames.length === 0 || selectedSpecIds.length === 0) return;
    setLinking(true);
    let success = 0;
    let skipped = 0;
    let failed = 0;

    for (const specId of selectedSpecIds) {
      for (const pn of partNames) {
        const { error } = await supabase
          .from("part_name_specifications")
          .upsert({ part_name_id: pn.id, specification_id: specId }, { onConflict: "part_name_id,specification_id" });
        if (error) {
          if (error.message.includes("duplicate")) {
            skipped++;
          } else {
            failed++;
          }
        } else {
          success++;
        }
      }
    }

    setLinking(false);
    setResultText(`关联完成：成功 ${success} 条，跳过 ${skipped} 条，失败 ${failed} 条`);
    onSuccess();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md">
        <h3 className="text-base font-semibold text-gray-900 mb-1">批量按分类关联</h3>
        <p className="text-sm text-gray-500 mb-4">已选择 {selectedSpecIds.length} 个规格，选择分类后将该分类下的所有配件名称关联到选中的规格。</p>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">选择配件分类</label>
          <select
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={selectedCategoryId}
            onChange={(e) => setSelectedCategoryId(e.target.value)}
            disabled={loadingCategories}
          >
            <option value="">{loadingCategories ? "加载中..." : "请选择分类"}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {selectedCategoryId && (
          <div className="mb-4">
            <div className="text-sm text-gray-600 mb-1">该分类下共有 <span className="font-medium">{partNames.length}</span> 个配件名称</div>
            {loadingParts && <div className="text-xs text-gray-400">加载中...</div>}
            {!loadingParts && partNames.length > 0 && (
              <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                {partNames.map((pn) => (
                  <div key={pn.id} className="px-3 py-1.5 text-sm text-gray-700">{pn.name}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {resultText && (
          <div className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{resultText}</div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            {resultText ? "关闭" : "取消"}
          </button>
          {!resultText && (
            <button
              type="button"
              onClick={handleLink}
              disabled={linking || !selectedCategoryId || partNames.length === 0}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {linking ? "关联中..." : "确认关联"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
