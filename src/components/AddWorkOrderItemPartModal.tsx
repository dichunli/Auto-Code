"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { PartPickerModal } from "./PartPickerModal";
import { SearchDropdown } from "./SearchDropdown";
import { 标记本地结构编辑 } from "@/lib/localEditSignal";
import { 添加工单配件 } from "@/app/work-orders/parts-actions";

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

interface ExistingPartRow {
  part_name_id: string | null;
  part_id: string | null;
}

interface PickerPart {
  id: string;
  part_name_id: string | null;
  name: string;
  part_number: string | null;
  unit: string | null;
  part_brands: { name: string } | { name: string }[] | null;
  specification_text: string | null;
  part_specifications: { name: string } | null;
  unit_cost: number | null;
  unit_price: number | null;
  selectedQuantity?: number | null;
}

interface InsertPartRow {
  work_order_item_id: string;
  /* 库列允许 NULL（库存配件可能未关联名称目录） */
  part_name_id?: string | null;
  part_id?: string;
  part_number?: string;
  name?: string;
  unit?: string;
  brand?: string;
  specification?: string;
  unit_cost?: number | null;
  unit_price?: number | null;
  quantity?: number | null;
  customer_opinion: string;
  is_selected?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  itemId: string;
  serviceItemId?: string | null;
  itemName: string;
  vehicleModelId?: number | null;
  vin?: string | null;
}

export function AddWorkOrderItemPartModal({
  open,
  onClose,
  onSuccess,
  itemId,
  serviceItemId,
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

  // 搜索（受控值交给 SearchDropdown，防抖/查询/下拉由组件内部处理）
  const [searchQuery, setSearchQuery] = useState("");
  // 搜索后：先点选一个候选配件名称，填数量，再点"确认添加"才加入（不自动添加）
  const [pickedName, setPickedName] = useState<PartName | null>(null);
  const [pickedQty, setPickedQty] = useState<string>("");

  // 配件选择器弹窗
  const [pickerOpen, setPickerOpen] = useState(false);

  // 弹窗打开时加载预置配件
  useEffect(() => {
    if (!open) return;

    setSelectedPartNames([]);
    setSelectedRealParts([]);
    setSearchQuery("");
    setPickedName(null);
    setPickedQty("");
    setExistingPartNameIds(new Set());
    setExistingPartIds(new Set());

    if (serviceItemId) {
      setLoading(true);
      // 同时查预置配件 + 当前项目已存在的配件
      Promise.all([
        supabase
          .from("service_item_part_names")
          .select("part_name_id, quantity, part_names(id, name, unit, default_quantity)")
          .eq("service_item_id", serviceItemId)
          .order("sort_order", { ascending: true }),
        supabase
          .from("work_order_item_parts")
          .select("part_name_id, part_id")
          .eq("work_order_item_id", itemId)
          .not("part_name_id", "is", null),
      ]).then(([{ data: presetData }, { data: existingData }]) => {
        const existingNameIds = new Set((existingData || []).filter((r: ExistingPartRow) => r.part_name_id).map((row: ExistingPartRow) => row.part_name_id as string));
        const existingIds = new Set((existingData || []).filter((r: ExistingPartRow) => r.part_id).map((row: ExistingPartRow) => row.part_id as string));
        setExistingPartNameIds(existingNameIds);
        setExistingPartIds(existingIds);
        setPresetParts(
          ((presetData || []) as unknown as { part_name_id: string; quantity: number | null; part_names: PartName | null }[])
            .filter((row) => !existingNameIds.has(row.part_name_id))
            .map((row) => ({
              part_name_id: row.part_name_id,
              // 严格按项目预设的数量：预设没填就留空(null)，由工单里红框提醒按实车确定，
              // 不用配件名称的默认数量兜底。
              quantity: row.quantity ?? null,
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
          const existingNameIds = new Set((data || []).filter((r: ExistingPartRow) => r.part_name_id).map((row: ExistingPartRow) => row.part_name_id as string));
          const existingIds = new Set((data || []).filter((r: ExistingPartRow) => r.part_id).map((row: ExistingPartRow) => row.part_id as string));
          setExistingPartNameIds(existingNameIds);
          setExistingPartIds(existingIds);
          setLoading(false);
        });
      setPresetParts([]);
    }
     
  }, [open, serviceItemId, itemId]);

  /* 配件名称搜索（SearchDropdown 的 searchFn）：查询条件与原手写块完全一致 */
  async function 搜索配件名称(keyword: string): Promise<PartName[]> {
    const { data } = await supabase
      .from("part_names")
      .select("id, name, unit, default_quantity")
      .ilike("name", `%${keyword.trim()}%`)
      .order("name")
      .limit(20);
    return data || [];
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

  // 点选搜索结果为"候选"（不立即添加），带出默认数量供修改
  function pickFromSearch(part: PartName) {
    const exists = selectedPartNames.find((sp) => sp.part_name_id === part.id);
    if (exists) {
      alert("该配件已选择");
      return;
    }
    /* 原手写下拉里"已添加"项是禁用不可点的；收敛后下拉项都能点，这里拦截提示 */
    if (existingPartNameIds.has(part.id)) {
      alert("该配件已在本项目中，无需重复添加");
      return;
    }
    setPickedName(part);
    setPickedQty(part.default_quantity != null ? String(part.default_quantity) : "");
  }

  // 确认添加候选配件名称（填好数量后）
  function confirmAddPicked() {
    if (!pickedName) return;
    const qtyNum = pickedQty.trim() === "" ? null : Number(pickedQty);
    setSelectedPartNames((prev) => [
      ...prev,
      {
        part_name_id: pickedName.id,
        name: pickedName.name,
        unit: pickedName.unit || "件",
        quantity: qtyNum,
      },
    ]);
    setPickedName(null);
    setPickedQty("");
    setSearchQuery("");
  }

  // 移除已选配件名称
  function removeSelectedName(partNameId: string) {
    setSelectedPartNames((prev) => prev.filter((sp) => sp.part_name_id !== partNameId));
  }

  // 处理从配件选择器返回的配件
  function handlePickerConfirm(parts: PickerPart[]) {
    setSelectedRealParts((prev) => {
      const next = [...prev];
      for (const part of parts) {
        if (next.some((p) => p.part_id === part.id)) continue;
        if (existingPartIds.has(part.id)) continue;
        const pb = part.part_brands;
        const brandName = (Array.isArray(pb) ? pb[0]?.name : pb?.name) || "";
        next.push({
          part_id: part.id,
          part_name_id: part.part_name_id,
          name: part.name,
          part_number: part.part_number || "",
          unit: part.unit || "件",
          brand: brandName,
          specification: part.specification_text || part.part_specifications?.name || "",
          unit_cost: part.unit_cost,
          unit_price: part.unit_price,
          quantity: part.selectedQuantity ?? null,
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

  // 修改已选配件名称的数量（留空则为 null，工单里红框提醒按实车定）
  function updateNameQuantity(partNameId: string, qty: number | null) {
    setSelectedPartNames((prev) =>
      prev.map((sp) => (sp.part_name_id === partNameId ? { ...sp, quantity: qty } : sp))
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

    const inserts: InsertPartRow[] = [];

    // 配件名称类
    for (const sp of selectedPartNames) {
      inserts.push({
        work_order_item_id: itemId,
        part_name_id: sp.part_name_id,
        name: sp.name,
        unit: sp.unit,
        quantity: sp.quantity,
        customer_opinion: "pending",
        is_selected: true,
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
        is_selected: true,
      });
    }

    // 标记本项目为"自己刚结构改动"，避免实时同步把自己的新增当成别人的改动弹提示条。
    标记本地结构编辑(itemId);

    // 写库收编为 Server Action（RPC 事务函数，配件行归属按 p_item_id=itemId，与行内 work_order_item_id 一致）
    let 新id列表: string[] = [];
    try {
      const 结果 = await 添加工单配件(itemId, inserts as unknown as Record<string, unknown>[]);
      if (!结果.success) {
        alert("添加失败: " + (结果.error || "未知错误"));
        setSaving(false);
        return;
      }
      新id列表 = 结果.ids || [];
    } catch (err: unknown) {
      alert("添加失败: " + (err instanceof Error ? err.message : String(err)));
      setSaving(false);
      return;
    }

    // 按返回 ids 只读补查新行（广播小计/合计需要数量/单价/选中态）
    let 新配件们: { id: string; quantity: number | null; unit_price: number | null; is_selected: boolean | null }[] = [];
    if (新id列表.length > 0) {
      const { data } = await supabase
        .from("work_order_item_parts")
        .select("id, quantity, unit_price, is_selected")
        .in("id", 新id列表);
      新配件们 = data || [];
    }

    setSaving(false);

    // 广播配件新增事件：项目小计/页底合计监听后自动加上新配件金额（不整页刷新）
    for (const 新配件 of 新配件们 || []) {
      window.dispatchEvent(
        new CustomEvent("wo-part-update", {
          detail: {
            itemId,
            partId: 新配件.id,
            added: true,
            quantity: 新配件.quantity || 1,
            unit_price: 新配件.unit_price || 0,
            is_selected: 新配件.is_selected ?? true,
          },
        })
      );
    }

    onSuccess();
  }


  if (!open) return null;

  const totalSelected = selectedPartNames.length + selectedRealParts.length;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
        <div className="relative bg-white rounded-xl border border-gray-200 w-full max-w-5xl max-h-[90vh] flex flex-col mx-4">
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
              {serviceItemId && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">关联配件（点击选择）</h3>
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
                              <span className="text-xs text-gray-500 ml-2">
                                {preset.quantity != null
                                  ? `× ${preset.quantity} ${preset.part_names?.unit || "件"}`
                                  : `单位: ${preset.part_names?.unit || "件"}`}
                              </span>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 手动搜索（通用 SearchDropdown：防抖/键盘导航/点外关闭内置） */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">手动搜索添加</h3>
                <SearchDropdown<PartName>
                  value={searchQuery}
                  onQueryChange={setSearchQuery}
                  searchFn={搜索配件名称}
                  getKey={(part) => part.id}
                  onSelect={pickFromSearch}
                  placeholder="输入配件名称搜索..."
                  emptyText="未找到匹配配件"
                  renderItem={(part) => {
                    const alreadySelected = selectedPartNames.some(
                      (sp) => sp.part_name_id === part.id
                    );
                    const alreadyExists = existingPartNameIds.has(part.id);
                    const isPicked = pickedName?.id === part.id;
                    const disabled = alreadySelected || alreadyExists;
                    return (
                      <>
                        <span className={`font-medium ${disabled ? "text-gray-400" : ""}`}>{part.name}</span>
                        <span className="text-xs text-gray-400 ml-2">
                          单位: {part.unit || "件"}
                        </span>
                        {alreadySelected && (
                          <span className="text-xs text-blue-600 ml-2">已选择</span>
                        )}
                        {alreadyExists && !alreadySelected && (
                          <span className="text-xs text-gray-400 ml-2">已添加</span>
                        )}
                        {isPicked && !disabled && (
                          <span className="text-xs text-blue-600 ml-2">已点选</span>
                        )}
                      </>
                    );
                  }}
                />

                {/* 点选候选后：填数量 + 确认添加 */}
                {pickedName && (
                  <div className="mt-2 flex items-center gap-2 p-2 rounded-lg border border-blue-200 bg-blue-50">
                    <span className="text-sm font-medium text-blue-800 flex-1 truncate">{pickedName.name}</span>
                    <input
                      type="number"
                      min="0"
                      value={pickedQty}
                      onChange={(e) => setPickedQty(e.target.value)}
                      placeholder="数量"
                      className="w-16 px-1.5 py-1 border border-blue-200 rounded text-xs text-right bg-white"
                    />
                    <span className="text-xs text-blue-500">{pickedName.unit || "件"}</span>
                    <button
                      type="button"
                      onClick={confirmAddPicked}
                      className="px-3 py-1 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700 shrink-0"
                    >
                      确认添加
                    </button>
                    <button
                      type="button"
                      onClick={() => { setPickedName(null); setPickedQty(""); }}
                      className="text-xs text-gray-400 hover:text-gray-600 shrink-0"
                    >
                      取消
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 右侧：从库存选择配件 */}
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
                + 选择配件（支持扫码枪，直接扫）
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
                    className="inline-flex items-center gap-1 pl-2 pr-1 py-1 bg-blue-100 text-blue-800 text-xs rounded-md"
                  >
                    {sp.name}
                    <span className="text-blue-500">×</span>
                    <input
                      type="number"
                      min="0"
                      value={sp.quantity ?? ""}
                      onChange={(e) => updateNameQuantity(sp.part_name_id, e.target.value === "" ? null : Number(e.target.value))}
                      placeholder="数量"
                      className={`w-12 px-1 py-0.5 rounded text-xs text-center bg-white border ${
                        sp.quantity == null ? "border-red-300 bg-red-50" : "border-blue-200"
                      }`}
                      title={sp.quantity == null ? "未填数量：将留空，工单里红框提醒按实车确定" : "数量"}
                    />
                    {sp.unit && <span className="text-blue-500">{sp.unit}</span>}
                    <button
                      type="button"
                      onClick={() => removeSelectedName(sp.part_name_id)}
                      className="text-blue-600 hover:text-blue-800 ml-0.5"
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

    </>,
    document.body
  );
}
