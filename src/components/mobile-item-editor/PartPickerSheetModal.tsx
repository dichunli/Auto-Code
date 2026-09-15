"use client";

import type { ItemData, PartNameResult, SelectedPartName, SelectedRealPart, PresetPart, InventoryPart } from "./types";

/* 配件选择覆盖层（2026-09-16 从 MobileItemEditor 原样拆出，JSX 未改一字）
 * 两个 Tab（按名称添加 / 从配件库选择）+ 已选列表；状态仍由父组件持有，
 * 本组件只做展示与回传，纯 props 边界 */
interface PartPickerSheetModalProps {
  onClose: () => void;
  item: ItemData;
  /* Tab 与名称搜索 */
  partTab: "name" | "inventory";
  setPartTab: (v: "name" | "inventory") => void;
  partSearchQuery: string;
  onPartSearchChange: (v: string) => void;
  partSearching: boolean;
  partSearchResults: PartNameResult[];
  /* 关联/预设配件 */
  presetLoading: boolean;
  presetParts: PresetPart[];
  commonTags: { part_name_id: string; name: string }[];
  /* 已选（名称） */
  selectedPartNames: SelectedPartName[];
  addPresetPart: (p: PresetPart) => void;
  addPartNameFromSearch: (p: PartNameResult) => void;
  updatePartNameQuantity: (partNameId: string, qty: number | null) => void;
  removeSelectedPartName: (partNameId: string) => void;
  /* 配件库搜索 */
  inventorySearchQuery: string;
  onInventorySearchChange: (v: string) => void;
  setInventorySearchQuery: (v: string) => void;
  doInventorySearch: (keyword: string) => void;
  inventorySearching: boolean;
  inventorySearchResults: InventoryPart[];
  linkedPartIds: Set<string>;
  /* 已选（库存） */
  selectedRealParts: SelectedRealPart[];
  addInventoryPart: (p: InventoryPart) => void;
  updateRealPartQuantity: (partId: string, qty: number | null) => void;
  removeSelectedRealPart: (partId: string) => void;
  /* 扫码与保存 */
  onOpenBarcodeScanner: () => void;
  loading: boolean;
  onSave: () => void;
}

export function PartPickerSheetModal({
  onClose,
  item,
  partTab,
  setPartTab,
  partSearchQuery,
  onPartSearchChange,
  partSearching,
  partSearchResults,
  presetLoading,
  presetParts,
  commonTags,
  selectedPartNames,
  addPresetPart,
  addPartNameFromSearch,
  updatePartNameQuantity,
  removeSelectedPartName,
  inventorySearchQuery,
  onInventorySearchChange,
  setInventorySearchQuery,
  doInventorySearch,
  inventorySearching,
  inventorySearchResults,
  linkedPartIds,
  selectedRealParts,
  addInventoryPart,
  updateRealPartQuantity,
  removeSelectedRealPart,
  onOpenBarcodeScanner,
  loading,
  onSave,
}: PartPickerSheetModalProps) {
  return (
    <div className="fixed inset-0 z-[110] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl mx-2 mb-2 max-h-[92dvh] flex flex-col animate-slide-up">
        {/* 顶部固定：项目信息 */}
        <div className="shrink-0 px-4 pt-4 pb-2 border-b border-gray-100 flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-gray-900 truncate">{item.alias_name || item.name}</h3>
            <p className="text-xs text-gray-500">
              {item.item_type === "labor" ? "工时" : item.item_type === "part" ? "配件" : "其他"} ·
              ¥{item.unit_price || 0} × {item.quantity || 1} = ¥{(item.unit_price || 0) * (item.quantity || 1)}
            </p>
          </div>
        </div>

        {/* Tab 切换 */}
        <div className="shrink-0 flex border-b border-gray-100">
          <button
            type="button"
            onClick={() => setPartTab("name")}
            className={`flex-1 py-2.5 text-xs font-medium text-center transition-colors ${
              partTab === "name"
                ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            添加配件名称
          </button>
          <button
            type="button"
            onClick={() => setPartTab("inventory")}
            className={`flex-1 py-2.5 text-xs font-medium text-center transition-colors ${
              partTab === "inventory"
                ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            从配件库中选择
          </button>
        </div>

        {/* 可滚动内容区：上半部分 Tab 内容 + 下半部分已选列表 */}
        <div className="flex-1 overflow-y-auto">
          {/* 上半：Tab 内容 */}
          <div className="px-4 py-3">
            {partTab === "name" && (
              <div className="space-y-3">
                <input
                  type="text"
                  value={partSearchQuery}
                  onChange={(e) => onPartSearchChange(e.target.value)}
                  onFocus={(e) => {
                    setTimeout(() => {
                      e.target.scrollIntoView({ behavior: "smooth", block: "center" });
                    }, 300);
                  }}
                  placeholder="搜索配件名称..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                />
                {partSearching && <p className="text-xs text-gray-400">搜索中...</p>}
                {partSearchQuery.trim() && !partSearching && partSearchResults.length === 0 && (
                  <p className="text-xs text-gray-400">未找到匹配配件</p>
                )}

                {/* 推荐配件 */}
                {partSearchQuery.trim() === "" && (
                  <div>
                    {presetLoading ? (
                      <p className="text-xs text-gray-400">加载关联配件...</p>
                    ) : presetParts.length > 0 ? (
                      <div className="space-y-1.5">
                        <p className="text-xs text-gray-500">关联配件（点击添加）</p>
                        {presetParts.map((preset) => {
                          const alreadySelected = selectedPartNames.some((sp) => sp.part_name_id === preset.part_name_id);
                          return (
                            <button
                              key={preset.part_name_id}
                              type="button"
                              onClick={() => addPresetPart(preset)}
                              className={`w-full text-left px-3 py-2.5 text-sm rounded-lg border ${
                                alreadySelected ? "bg-blue-50 border-blue-300 hover:bg-blue-100" : "bg-amber-50 border-amber-200 hover:bg-amber-100"
                              }`}
                            >
                              <span className="font-medium text-gray-900">{preset.name}</span>
                              <span className="text-xs text-gray-500 ml-2">× {preset.quantity ?? 1} {preset.unit}</span>
                              {alreadySelected && <span className="text-xs text-blue-600 ml-2">已选择 · 点击取消</span>}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                )}

                {/* 全部配件 / 搜索结果 */}
                {partSearchResults.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-gray-500">{partSearchQuery.trim() ? "搜索结果" : "配件名称"}</p>
                    {partSearchResults.map((part) => {
                      const alreadySelected = selectedPartNames.some((sp) => sp.part_name_id === part.id);
                      return (
                        <button
                          key={part.id}
                          type="button"
                          onClick={() => addPartNameFromSearch(part)}
                          className={`w-full text-left px-3 py-2 text-sm rounded-lg border-b border-gray-100 last:border-0 ${
                            alreadySelected ? "bg-blue-50 hover:bg-blue-100" : "hover:bg-blue-50"
                          }`}
                        >
                          <span className="font-medium">{part.name}</span>
                          <span className="text-xs text-gray-400 ml-2">单位: {part.unit || "件"}</span>
                          {alreadySelected && <span className="text-xs text-blue-600 ml-2">已选择 · 点击取消</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
                {partSearchResults.length === 0 && !partSearching && partSearchQuery.trim() === "" && presetParts.length === 0 && (
                  <div className="text-center py-6">
                    <p className="text-xs text-gray-400">暂无配件名称</p>
                  </div>
                )}
              </div>
            )}
            {partTab === "inventory" && (
              <div className="space-y-3">
                {/* 搜索框 + 扫码 */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inventorySearchQuery}
                    onChange={(e) => onInventorySearchChange(e.target.value)}
                    onFocus={(e) => {
                      setTimeout(() => {
                        e.target.scrollIntoView({ behavior: "smooth", block: "center" });
                      }, 300);
                    }}
                    placeholder="搜索配件编码或名称..."
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  />
                  <button
                    type="button"
                    onClick={onOpenBarcodeScanner}
                    className="px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 whitespace-nowrap shrink-0"
                  >
                    扫码
                  </button>
                </div>

                {/* 快捷标签 */}
                <div className="flex flex-wrap gap-1.5">
                  {(presetParts.length > 0 ? presetParts : commonTags).map((tag) => (
                    <button
                      key={tag.part_name_id}
                      type="button"
                      onClick={() => {
                        if (inventorySearchQuery === tag.name) {
                          setInventorySearchQuery("");
                          doInventorySearch("");
                        } else {
                          setInventorySearchQuery(tag.name);
                          doInventorySearch(tag.name);
                        }
                      }}
                      className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                        inventorySearchQuery === tag.name
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                      }`}
                    >
                      {tag.name}
                    </button>
                  ))}
                  {presetParts.length === 0 && commonTags.length === 0 && (
                    <span className="text-xs text-gray-400">加载常用标签...</span>
                  )}
                </div>

                {/* 配件列表 */}
                {inventorySearching ? (
                  <p className="text-xs text-gray-400 text-center py-4">加载中...</p>
                ) : inventorySearchResults.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4">未找到配件</p>
                ) : (
                  <div className="space-y-1">
                    {inventorySearchResults.map((part) => {
                      const isLinked = linkedPartIds.has(part.id);
                      const hasStock = (part.quantity || 0) > 0;
                      const alreadySelected = selectedRealParts.some((sp) => sp.part_id === part.id);
                      return (
                        <button
                          key={part.id}
                          type="button"
                          onClick={() => !alreadySelected && addInventoryPart(part)}
                          disabled={alreadySelected}
                          className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                            alreadySelected
                              ? "bg-gray-100 border-gray-200 opacity-50"
                              : isLinked
                                ? "bg-blue-50 border-blue-200 hover:bg-blue-100"
                                : "bg-white border-gray-100 hover:bg-gray-50"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-gray-900 truncate">
                                {part.name}
                                {isLinked && (
                                  <span className="ml-1 text-xs text-blue-600 font-normal">(匹配车型)</span>
                                )}
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5">
                                {part.part_number && <span>编码: {part.part_number} · </span>}
                                库存:{" "}
                                <span className={hasStock ? "text-green-600 font-medium" : "text-red-500"}>
                                  {part.quantity || 0}
                                </span>
                              </div>
                            </div>
                            <div className="shrink-0 ml-3 text-right">
                              <div className="text-sm font-medium text-gray-900">
                                ¥{part.unit_price || 0}
                              </div>
                              {alreadySelected && (
                                <div className="text-[10px] text-gray-400">已添加</div>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 下半：已选配件列表 */}
          {(selectedPartNames.length > 0 || selectedRealParts.length > 0) && (
            <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
              <p className="text-xs text-gray-500 mb-2">
                已选择 ({selectedPartNames.length + selectedRealParts.length} 项)
              </p>
              <div className="space-y-1.5">
                {selectedPartNames.map((sp) => (
                  <div key={sp.part_name_id} className="flex items-center gap-2 p-1.5 rounded border border-blue-200 bg-blue-50">
                    <div className="flex-1 min-w-0 text-sm text-gray-900 truncate">{sp.name}</div>
                    <input
                      type="number"
                      min={1}
                      value={sp.quantity ?? ""}
                      onChange={(e) => updatePartNameQuantity(sp.part_name_id, e.target.value === "" ? null : parseInt(e.target.value) || 1)}
                      className="w-12 px-1 py-0.5 border border-gray-200 rounded text-xs text-center"
                    />
                    <span className="text-xs text-gray-500">{sp.unit}</span>
                    <button
                      type="button"
                      onClick={() => removeSelectedPartName(sp.part_name_id)}
                      className="text-xs text-red-600 px-1"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {selectedRealParts.map((sp) => (
                  <div key={sp.part_id} className="flex items-center gap-2 p-1.5 rounded border border-green-200 bg-green-50">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-900 truncate">{sp.name}</div>
                      <div className="text-[10px] text-gray-500">
                        {sp.part_number && <span>{sp.part_number} · </span>}
                        {sp.brand}
                      </div>
                    </div>
                    <input
                      type="number"
                      min={1}
                      value={sp.quantity ?? ""}
                      onChange={(e) => updateRealPartQuantity(sp.part_id, e.target.value === "" ? null : parseInt(e.target.value) || 1)}
                      className="w-12 px-1 py-0.5 border border-gray-200 rounded text-xs text-center"
                    />
                    <span className="text-xs text-gray-500">{sp.unit}</span>
                    <button
                      type="button"
                      onClick={() => removeSelectedRealPart(sp.part_id)}
                      className="text-xs text-red-600 px-1"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="shrink-0 px-4 py-3 border-t border-gray-100 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={loading || (selectedPartNames.length === 0 && selectedRealParts.length === 0)}
            className="flex-1 px-4 py-2 text-xs text-white bg-blue-600 rounded-lg disabled:opacity-50"
          >
            {loading ? "保存中..." : "确认添加"}
          </button>
        </div>
      </div>
    </div>
  );
}
