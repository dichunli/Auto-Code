"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";

interface ServiceItem {
  id: string;
  name: string;
  code?: string | null;
  default_price?: number | null;
  standard_hours?: number | null;
  require_qc?: boolean | null;
}

interface Props {
  open: boolean;
  itemId: string;
  currentName: string;
  currentAlias: string | null;
  currentQuantity: number;
  currentUnitPrice: number;
  /* 当前"必须质检"设置（工单内可覆盖维修项目库的默认值） */
  currentRequireQc?: boolean | null;
  onClose: () => void;
}

export function EditWorkOrderItemModal({
  open,
  itemId,
  currentName,
  currentAlias,
  currentQuantity,
  currentUnitPrice,
  currentRequireQc,
  onClose,
}: Props) {
  const supabase = createClient();
  const [aliasName, setAliasName] = useState(currentAlias || "");
  const [quantity, setQuantity] = useState(String(currentQuantity || 1));
  const [unitPrice, setUnitPrice] = useState(currentUnitPrice != null ? currentUnitPrice.toFixed(2) : "0.00");
  const [requireQc, setRequireQc] = useState(!!currentRequireQc);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchResults, setSearchResults] = useState<ServiceItem[]>([]);
  const [selectedServiceItem, setSelectedServiceItem] = useState<ServiceItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setAliasName(currentAlias || "");
      setQuantity(String(currentQuantity || 1));
      setUnitPrice(String(currentUnitPrice || 0));
      setRequireQc(!!currentRequireQc);
      setSearchKeyword("");
      setSearchResults([]);
      setSelectedServiceItem(null);
    }
  }, [open, currentAlias, currentQuantity, currentUnitPrice, currentRequireQc]);

  async function doSearch(keyword: string) {
    if (!keyword.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const { data } = await supabase
      .from("service_items")
      .select("id, name, code, default_price, standard_hours, require_qc")
      .ilike("name", `%${keyword.trim()}%`)
      .limit(20);
    setSearchResults((data || []) as ServiceItem[]);
    setSearching(false);
  }

  function handleSearchChange(val: string) {
    setSearchKeyword(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => doSearch(val), 300);
  }

  function handleSelectServiceItem(si: ServiceItem) {
    setSelectedServiceItem(si);
    setSearchKeyword(si.name);
    setSearchResults([]);
    // 自动填入新项目的价格
    if (si.default_price != null) {
      setUnitPrice(si.default_price.toFixed(2));
    }
    // 带入新项目库的"必须质检"默认设置
    setRequireQc(!!si.require_qc);
  }

  async function handleSave() {
    setLoading(true);

    const 新数量 = parseFloat(quantity) || 1;
    const 新单价 = parseFloat(unitPrice) || 0;

    const updateData: Record<string, unknown> = {
      alias_name: aliasName.trim() || null,
      quantity: 新数量,
      unit_price: 新单价,
      require_qc: requireQc,
    };

    if (selectedServiceItem) {
      updateData.service_item_id = selectedServiceItem.id;
      updateData.name = selectedServiceItem.name;
      // 如果用户清空了别名，使用新项目名称
      if (!aliasName.trim()) {
        updateData.alias_name = null;
      }
    }

    const { error } = await supabase
      .from("work_order_items")
      .update(updateData)
      .eq("id", itemId);

    setLoading(false);
    if (error) {
      alert("保存失败: " + error.message);
      return;
    }

    /* 局部更新：广播项目变更事件，项目名/小计/页底合计各自监听更新，
     * 不整页刷新（整页刷新要 20 次境外查询，慢且可能超时显示旧数据）。
     * total_price 与数据库生成列同公式（quantity * unit_price），转分处理浮点。 */
    window.dispatchEvent(
      new CustomEvent("wo-item-update", {
        detail: {
          itemId,
          name: updateData.name as string | undefined,
          alias_name: updateData.alias_name,
          quantity: 新数量,
          unit_price: 新单价,
          total_price: Math.round(新数量 * 新单价 * 100) / 100,
        },
      })
    );
    onClose();
  }

  // Portal 到 body：逃出项目行 sticky 操作区的层叠上下文，
  // 否则遮罩 z-50 只在 sticky 上下文内有效，会被配件行穿透
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">编辑维修项目</h2>

        <div className="space-y-4">
          {/* 当前项目 */}
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">当前项目</p>
            <p className="text-sm font-medium text-gray-900">{currentName}</p>
          </div>

          {/* 替换项目 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">替换为其他项目（可选）</label>
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="输入项目名称搜索..."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
            {selectedServiceItem && (
              <p className="text-xs text-green-600 mt-1">
                已选择: {selectedServiceItem.name} {selectedServiceItem.default_price ? `(默认价 ¥${selectedServiceItem.default_price})` : ""}
              </p>
            )}
            {searching && <p className="text-xs text-gray-400 mt-1">搜索中...</p>}
            {searchResults.length > 0 && (
              <div className="mt-1 border border-gray-200 rounded-lg max-h-40 overflow-y-auto">
                {searchResults.map((si) => (
                  <button
                    key={si.id}
                    type="button"
                    onClick={() => handleSelectServiceItem(si)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                  >
                    <span className="font-medium">{si.name}</span>
                    {si.code && <span className="text-xs text-gray-400 ml-2">{si.code}</span>}
                    {si.default_price != null && (
                      <span className="text-xs text-gray-500 ml-2">¥{si.default_price}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {searchKeyword.trim() && !searching && searchResults.length === 0 && (
              <p className="text-xs text-gray-400 mt-1">未找到匹配项目</p>
            )}
          </div>

          {/* 别名 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">别名</label>
            <input
              type="text"
              value={aliasName}
              onChange={(e) => setAliasName(e.target.value)}
              placeholder="输入别名（可选）"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>

          {/* 数量与单价 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">数量</label>
              <input
                type="number"
                step="0.01"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">单价</label>
              <input
                type="number"
                step="0.01"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-right"
              />
            </div>
          </div>

          <div className="text-xs text-gray-500">
            总价 = {((parseFloat(quantity) || 0) * (parseFloat(unitPrice) || 0)).toFixed(2)} 元
          </div>

          {/* 必须质检开关：开启后项目完工进入"待质检"，质检合格才算已完工 */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={requireQc}
              onChange={(e) => setRequireQc(e.target.checked)}
              className="w-4 h-4 accent-purple-600"
            />
            <span className="text-sm text-gray-700">必须质检</span>
            <span className="text-xs text-gray-400">（完工后需质检合格才算已完工）</span>
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
