"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface PartName {
  id: string;
  name: string;
  unit: string;
  default_quantity: number | null;
}

interface PresetPart {
  part_name_id: string;
  quantity: number | null;
  part_names: PartName | null;
}

interface SelectedPart {
  part_name_id: string;
  name: string;
  unit: string;
  quantity: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  itemId: string;
  serviceNameId?: string | null;
  itemName: string;
}

export function AddWorkOrderItemPartModal({
  open,
  onClose,
  onSuccess,
  itemId,
  serviceNameId,
  itemName,
}: Props) {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // 预置配件
  const [presetParts, setPresetParts] = useState<PresetPart[]>([]);

  // 当前项目已存在的 part_name_id（用于过滤预置列表，避免重复）
  const [existingPartNameIds, setExistingPartNameIds] = useState<Set<string>>(new Set());

  // 已选配件（预置 + 手动搜索）
  const [selectedParts, setSelectedParts] = useState<SelectedPart[]>([]);

  // 搜索
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PartName[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 弹窗打开时加载预置配件
  useEffect(() => {
    if (!open) return;

    setSelectedParts([]);
    setSearchQuery("");
    setSearchResults([]);
    setExistingPartNameIds(new Set());

    if (serviceNameId) {
      setLoading(true);
      // 同时查预置配件 + 当前项目已存在的配件
      Promise.all([
        supabase
          .from("service_name_part_names")
          .select("part_name_id, quantity, part_names(id, name, unit, default_quantity)")
          .eq("service_name_id", serviceNameId)
          .order("sort_order", { ascending: true }),
        supabase
          .from("work_order_item_parts")
          .select("part_name_id")
          .eq("work_order_item_id", itemId)
          .not("part_name_id", "is", null),
      ]).then(([{ data: presetData }, { data: existingData }]) => {
        const existingIds = new Set((existingData || []).map((row: any) => row.part_name_id as string));
        setExistingPartNameIds(existingIds);
        setPresetParts(
          (presetData || [])
            .filter((row: any) => !existingIds.has(row.part_name_id))
            .map((row: any) => ({
              part_name_id: row.part_name_id,
              quantity: row.quantity ?? row.part_names?.default_quantity ?? null,
              part_names: row.part_names,
            }))
        );
        setLoading(false);
      });
    } else {
      setPresetParts([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, serviceNameId, itemId]);

  // 搜索配件名称
  const doSearch = useCallback(
    async (keyword: string) => {
      if (!keyword.trim()) {
        setSearchResults([]);
        return;
      }
      setSearching(true);
      const { data } = await supabase
        .from("part_names")
        .select("id, name, unit, default_quantity")
        .ilike("name", `%${keyword.trim()}%`)
        .order("name")
        .limit(20);
      setSearchResults(data || []);
      setSearching(false);
    },
    [supabase]
  );

  function handleSearchChange(val: string) {
    setSearchQuery(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => doSearch(val), 300);
  }

  // 切换预置配件的选中状态
  function togglePresetPart(preset: PresetPart) {
    const exists = selectedParts.find((sp) => sp.part_name_id === preset.part_name_id);
    if (exists) {
      setSelectedParts((prev) => prev.filter((sp) => sp.part_name_id !== preset.part_name_id));
    } else {
      setSelectedParts((prev) => [
        ...prev,
        {
          part_name_id: preset.part_name_id,
          name: preset.part_names?.name || "未命名配件",
          unit: preset.part_names?.unit || "件",
          quantity: preset.quantity,
        },
      ]);
    }
  }

  // 从搜索结果中添加配件
  function addFromSearch(part: PartName) {
    const exists = selectedParts.find((sp) => sp.part_name_id === part.id);
    if (exists) {
      alert("该配件已选择");
      return;
    }
    setSelectedParts((prev) => [
      ...prev,
      {
        part_name_id: part.id,
        name: part.name,
        unit: part.unit || "件",
        quantity: part.default_quantity ?? null,
      },
    ]);
    setSearchQuery("");
    setSearchResults([]);
  }

  // 修改已选配件的数量
  function updateQuantity(partNameId: string, qty: number | null) {
    setSelectedParts((prev) =>
      prev.map((sp) => (sp.part_name_id === partNameId ? { ...sp, quantity: qty } : sp))
    );
  }

  // 移除已选配件
  function removeSelected(partNameId: string) {
    setSelectedParts((prev) => prev.filter((sp) => sp.part_name_id !== partNameId));
  }

  // 保存
  async function handleSave() {
    if (selectedParts.length === 0) {
      alert("请至少选择一个配件");
      return;
    }

    setSaving(true);
    const inserts = selectedParts.map((sp) => ({
      work_order_item_id: itemId,
      part_name_id: sp.part_name_id,
      name: sp.name,
      unit: sp.unit,
      quantity: sp.quantity,
      customer_opinion: "pending",
    }));

    const { error } = await supabase.from("work_order_item_parts").insert(inserts);

    setSaving(false);
    if (error) {
      alert("添加失败: " + error.message);
      return;
    }

    onSuccess();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-lg max-h-[85vh] flex flex-col mx-4">
        {/* 标题 */}
        <h2 className="text-lg font-semibold text-gray-900 mb-1">
          为「{itemName}」添加配件
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          {serviceNameId
            ? "系统已根据项目名称预置了常用配件，您也可以手动搜索添加"
            : "请搜索配件名称进行添加"}
        </p>

        <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
          {/* 预置配件 */}
          {serviceNameId && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">系统预置配件</h3>
              {loading ? (
                <p className="text-xs text-gray-400">加载中...</p>
              ) : presetParts.length === 0 ? (
                <p className="text-xs text-gray-400">该项目暂无预置配件</p>
              ) : (
                <div className="space-y-2">
                  {presetParts.map((preset) => {
                    const isSelected = selectedParts.some(
                      (sp) => sp.part_name_id === preset.part_name_id
                    );
                    return (
                      <label
                        key={preset.part_name_id}
                        className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                          isSelected
                            ? "border-blue-300 bg-blue-50"
                            : "border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => togglePresetPart(preset)}
                          className="w-4 h-4 text-blue-600 rounded"
                        />
                        <div className="flex-1">
                          <span className="text-sm font-medium text-gray-900">
                            {preset.part_names?.name || "未命名配件"}
                          </span>
                          <span className="text-xs text-gray-400 ml-2">
                            默认数量: {preset.quantity}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 手动搜索 */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">手动搜索添加</h3>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="输入配件名称搜索..."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
            {searching && <p className="text-xs text-gray-400 mt-1">搜索中...</p>}
            {searchResults.length > 0 && (
              <div className="mt-2 border border-gray-200 rounded-lg max-h-40 overflow-y-auto">
                {searchResults.map((part) => {
                  const alreadySelected = selectedParts.some(
                    (sp) => sp.part_name_id === part.id
                  );
                  const alreadyExists = existingPartNameIds.has(part.id);
                  const disabled = alreadySelected || alreadyExists;
                  return (
                    <button
                      key={part.id}
                      type="button"
                      onClick={() => !disabled && addFromSearch(part)}
                      disabled={disabled}
                      className={`w-full text-left px-3 py-2 text-sm border-b border-gray-100 last:border-0 ${
                        disabled
                          ? "text-gray-400 bg-gray-50 cursor-not-allowed"
                          : "hover:bg-gray-50"
                      }`}
                    >
                      <span className="font-medium">{part.name}</span>
                      <span className="text-xs text-gray-400 ml-2">
                        单位: {part.unit || "件"}
                      </span>
                      {alreadySelected && (
                        <span className="text-xs text-blue-600 ml-2">已选择</span>
                      )}
                      {alreadyExists && !alreadySelected && (
                        <span className="text-xs text-gray-400 ml-2">已添加</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {searchQuery.trim() && !searching && searchResults.length === 0 && (
              <p className="text-xs text-gray-400 mt-1">未找到匹配配件</p>
            )}
          </div>

          {/* 已选配件列表（可修改数量） */}
          {selectedParts.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">
                已选择 ({selectedParts.length}个)
              </h3>
              <div className="space-y-2">
                {selectedParts.map((sp) => (
                  <div
                    key={sp.part_name_id}
                    className="flex items-center gap-3 p-2.5 rounded-lg border border-blue-200 bg-blue-50"
                  >
                    <span className="flex-1 text-sm font-medium text-gray-900">
                      {sp.name}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">数量</span>
                      <input
                        type="number"
                        min={1}
                        value={sp.quantity ?? ""}
                        onChange={(e) =>
                          updateQuantity(
                            sp.part_name_id,
                            e.target.value === "" ? null : parseInt(e.target.value) || 1
                          )
                        }
                        className="w-16 px-2 py-1 border border-gray-200 rounded text-sm text-center"
                      />
                      <span className="text-xs text-gray-500">{sp.unit}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSelected(sp.part_name_id)}
                      className="text-xs text-red-600 hover:text-red-700 px-2"
                    >
                      移除
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || selectedParts.length === 0}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "保存中..." : `添加 (${selectedParts.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
