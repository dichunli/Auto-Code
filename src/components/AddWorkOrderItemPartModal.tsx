"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { PartPickerModal } from "./PartPickerModal";

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

interface SelectedPartName {
  part_name_id: string;
  name: string;
  unit: string;
  quantity: number | null;
}

interface SelectedRealPart {
  part_id: string;
  part_name_id: string | null;
  name: string;
  part_number: string;
  unit: string;
  brand: string;
  specification: string;
  unit_cost: number | null;
  unit_price: number | null;
  quantity: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  itemId: string;
  serviceNameId?: string | null;
  itemName: string;
  vehicleModelId?: string | null;
}

export function AddWorkOrderItemPartModal({
  open,
  onClose,
  onSuccess,
  itemId,
  serviceNameId,
  itemName,
  vehicleModelId,
}: Props) {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // 预置配件
  const [presetParts, setPresetParts] = useState<PresetPart[]>([]);

  // 当前项目已存在的 part_name_id（用于过滤预置列表，避免重复）
  const [existingPartNameIds, setExistingPartNameIds] = useState<Set<string>>(new Set());

  // 当前项目已存在的 part_id（用于过滤库存选择，避免重复）
  const [existingPartIds, setExistingPartIds] = useState<Set<string>>(new Set());

  // 已选配件名称（左侧）
  const [selectedPartNames, setSelectedPartNames] = useState<SelectedPartName[]>([]);

  // 已选库存配件（右侧）
  const [selectedRealParts, setSelectedRealParts] = useState<SelectedRealPart[]>([]);

  // 搜索
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PartName[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 配件选择器弹窗
  const [pickerOpen, setPickerOpen] = useState(false);

  // 弹窗打开时加载预置配件
  useEffect(() => {
    if (!open) return;

    setSelectedPartNames([]);
    setSelectedRealParts([]);
    setSearchQuery("");
    setSearchResults([]);
    setExistingPartNameIds(new Set());
    setExistingPartIds(new Set());

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
          .select("part_name_id, part_id")
          .eq("work_order_item_id", itemId)
          .not("part_name_id", "is", null),
      ]).then(([{ data: presetData }, { data: existingData }]) => {
        const existingNameIds = new Set((existingData || []).filter((r: any) => r.part_name_id).map((row: any) => row.part_name_id as string));
        const existingIds = new Set((existingData || []).filter((r: any) => r.part_id).map((row: any) => row.part_id as string));
        setExistingPartNameIds(existingNameIds);
        setExistingPartIds(existingIds);
        setPresetParts(
          (presetData || [])
            .filter((row: any) => !existingNameIds.has(row.part_name_id))
            .map((row: any) => ({
              part_name_id: row.part_name_id,
              quantity: row.quantity ?? row.part_names?.default_quantity ?? null,
              part_names: row.part_names,
            }))
        );
        setLoading(false);
      });
    } else {
      // 无 serviceNameId 时也要查已存在的，避免重复添加库存配件
      setLoading(true);
      supabase
        .from("work_order_item_parts")
        .select("part_name_id, part_id")
        .eq("work_order_item_id", itemId)
        .then(({ data }) => {
          const existingNameIds = new Set((data || []).filter((r: any) => r.part_name_id).map((row: any) => row.part_name_id as string));
          const existingIds = new Set((data || []).filter((r: any) => r.part_id).map((row: any) => row.part_id as string));
          setExistingPartNameIds(existingNameIds);
          setExistingPartIds(existingIds);
          setLoading(false);
        });
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
    const exists = selectedPartNames.find((sp) => sp.part_name_id === preset.part_name_id);
    if (exists) {
      setSelectedPartNames((prev) => prev.filter((sp) => sp.part_name_id !== preset.part_name_id));
    } else {
      setSelectedPartNames((prev) => [
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

  // 从搜索结果中添加配件名称
  function addFromSearch(part: PartName) {
    const exists = selectedPartNames.find((sp) => sp.part_name_id === part.id);
    if (exists) {
      alert("该配件已选择");
      return;
    }
    setSelectedPartNames((prev) => [
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

  // 修改已选配件名称的数量
  function updateNameQuantity(partNameId: string, qty: number | null) {
    setSelectedPartNames((prev) =>
      prev.map((sp) => (sp.part_name_id === partNameId ? { ...sp, quantity: qty } : sp))
    );
  }

  // 移除已选配件名称
  function removeSelectedName(partNameId: string) {
    setSelectedPartNames((prev) => prev.filter((sp) => sp.part_name_id !== partNameId));
  }

  // 处理从配件选择器返回的配件
  function handlePickerConfirm(parts: any[]) {
    setSelectedRealParts((prev) => {
      const next = [...prev];
      for (const part of parts) {
        if (next.some((p) => p.part_id === part.id)) continue;
        if (existingPartIds.has(part.id)) continue;
        next.push({
          part_id: part.id,
          part_name_id: part.part_name_id,
          name: part.name,
          part_number: part.part_number || "",
          unit: part.unit || "件",
          brand: part.part_brands?.name || "",
          specification: part.specification_text || part.part_specifications?.name || "",
          unit_cost: part.unit_cost,
          unit_price: part.unit_price,
          quantity: part.selectedQuantity ?? 1,
        });
      }
      return next;
    });
    setPickerOpen(false);
  }

  // 修改已选库存配件的数量
  function updateRealQuantity(partId: string, qty: number | null) {
    setSelectedRealParts((prev) =>
      prev.map((sp) => (sp.part_id === partId ? { ...sp, quantity: qty } : sp))
    );
  }

  // 移除已选库存配件
  function removeSelectedReal(partId: string) {
    setSelectedRealParts((prev) => prev.filter((sp) => sp.part_id !== partId));
  }

  // 保存
  async function handleSave() {
    const totalCount = selectedPartNames.length + selectedRealParts.length;
    if (totalCount === 0) {
      alert("请至少选择一个配件");
      return;
    }

    setSaving(true);

    const inserts: any[] = [];

    // 配件名称类
    for (const sp of selectedPartNames) {
      inserts.push({
        work_order_item_id: itemId,
        part_name_id: sp.part_name_id,
        name: sp.name,
        unit: sp.unit,
        quantity: sp.quantity,
        customer_opinion: "pending",
      });
    }

    // 库存配件类
    for (const sp of selectedRealParts) {
      inserts.push({
        work_order_item_id: itemId,
        part_id: sp.part_id,
        part_name_id: sp.part_name_id,
        part_number: sp.part_number,
        name: sp.name,
        unit: sp.unit,
        brand: sp.brand,
        specification: sp.specification,
        unit_cost: sp.unit_cost,
        unit_price: sp.unit_price,
        quantity: sp.quantity,
        customer_opinion: "pending",
      });
    }

    const { error } = await supabase.from("work_order_item_parts").insert(inserts);

    setSaving(false);
    if (error) {
      alert("添加失败: " + error.message);
      return;
    }

    onSuccess();
  }

  if (!open) return null;

  const totalSelected = selectedPartNames.length + selectedRealParts.length;

  return (
    <>
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-xl border border-gray-200 w-full max-w-5xl max-h-[90vh] flex flex-col mx-4">
          {/* 标题 */}
          <div className="px-6 py-4 border-b border-gray-100 flex-shrink-0">
            <h2 className="text-lg font-semibold text-gray-900">
              为「{itemName}」添加配件
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              左侧添加配件名称，右侧从库存选择实际配件
            </p>
          </div>

          {/* 左右分栏 */}
          <div className="flex-1 overflow-hidden flex flex-col md:flex-row min-h-0">
            {/* 左侧：配件名称 */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 border-b md:border-b-0 md:border-r border-gray-100 space-y-5 min-h-0">
              <div className="text-sm font-medium text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg inline-block">
                方式一：选择配件名称
              </div>

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
                        const isSelected = selectedPartNames.some(
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
                      const alreadySelected = selectedPartNames.some(
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
            </div>

            {/* 右侧：库存配件 */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5 min-h-0">
              <div className="text-sm font-medium text-green-700 bg-green-50 px-3 py-1.5 rounded-lg inline-block">
                方式二：从库存选择配件
              </div>

              <p className="text-xs text-gray-500">
                选择实际库存配件，会自动带入编号、品牌、价格等信息
              </p>

              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="w-full py-3 border-2 border-dashed border-blue-300 rounded-xl text-blue-600 hover:bg-blue-50 hover:border-blue-400 transition-colors text-sm font-medium"
              >
                + 选择配件
              </button>

              {/* 已选库存配件列表 */}
              {selectedRealParts.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">
                    已选库存配件 ({selectedRealParts.length})
                  </h3>
                  <div className="space-y-2">
                    {selectedRealParts.map((sp) => (
                      <div
                        key={sp.part_id}
                        className="flex items-center gap-2 p-2.5 rounded-lg border border-green-200 bg-green-50"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate">
                            {sp.name}
                          </div>
                          <div className="text-xs text-gray-500">
                            {sp.part_number && <span className="mr-2">编号:{sp.part_number}</span>}
                            {sp.brand && <span className="mr-2">品牌:{sp.brand}</span>}
                            {sp.specification && <span>规格:{sp.specification}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs text-gray-500">数量</span>
                          <input
                            type="number"
                            min={1}
                            value={sp.quantity ?? ""}
                            onChange={(e) =>
                              updateRealQuantity(
                                sp.part_id,
                                e.target.value === "" ? null : parseInt(e.target.value) || 1
                              )
                            }
                            className="w-14 px-1 py-1 border border-gray-200 rounded text-sm text-center"
                          />
                          <span className="text-xs text-gray-500">{sp.unit}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeSelectedReal(sp.part_id)}
                          className="text-xs text-red-600 hover:text-red-700 px-2 flex-shrink-0"
                        >
                          移除
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 已选汇总 */}
          {(selectedPartNames.length > 0 || selectedRealParts.length > 0) && (
            <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 flex-shrink-0">
              <h3 className="text-sm font-medium text-gray-700 mb-2">
                已选择 ({totalSelected}个)
              </h3>
              <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
                {selectedPartNames.map((sp) => (
                  <span
                    key={sp.part_name_id}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-md"
                  >
                    {sp.name} x{sp.quantity ?? 1}
                    <button
                      type="button"
                      onClick={() => removeSelectedName(sp.part_name_id)}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {selectedRealParts.map((sp) => (
                  <span
                    key={sp.part_id}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 text-xs rounded-md"
                  >
                    {sp.name} x{sp.quantity ?? 1}
                    <button
                      type="button"
                      onClick={() => removeSelectedReal(sp.part_id)}
                      className="text-green-600 hover:text-green-800"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 底部按钮 */}
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 flex-shrink-0">
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
              disabled={saving || totalSelected === 0}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "保存中..." : `添加 (${totalSelected})`}
            </button>
          </div>
        </div>
      </div>

      {/* 配件选择器弹窗 */}
      <PartPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={handlePickerConfirm}
        vehicleModelId={vehicleModelId}
      />
    </>
  );
}
