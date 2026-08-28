"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { 批量添加工单项目 } from "@/app/work-orders/actions";

interface Props {
  open: boolean;
  onClose: () => void;
  orderId: string;
  requirementId: string;
  /* 车型ID是 INTEGER（vehicle_models.id 是数字主键） */
  vehicleModelId?: number | null;
}

type ServiceItem = {
  id: string;
  name: string;
  description: string | null;
  default_price: number | null;
  standard_hours: number | null;
  category_id: string | null;
  search_keywords: string | null;
  require_qc?: boolean | null;
  service_categories?: { id: string; name: string } | null;
};

type ServiceItemPrice = {
  service_item_id: string;
  vehicle_model_id: number;
  price: number | null;
};

/* 常用维修项目快捷标签 */
const QUICK_TAGS = [
  "机油",
  "刹车油",
  "变速箱油",
  "滤清器",
  "刹车片",
  "火花塞",
  "防冻液",
  "四轮定位",
  "差速器",
  "助力油",
  "底盘",
  "电瓶",
  "轮胎",
];

export default function ItemBatchPickerModal({ open, onClose, orderId, requirementId, vehicleModelId }: Props) {
  const supabase = createClient();
  const [allServiceItems, setAllServiceItems] = useState<ServiceItem[]>([]);
  const [serviceItemPrices, setServiceItemPrices] = useState<ServiceItemPrice[]>([]);
  const [query, setQuery] = useState("");
  const [defaultType] = useState<"labor" | "part" | "other">("labor");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIds([]);

    async function loadData() {
      setLoading(true);
      try {
        const { data: items, error } = await supabase
          .from("service_items")
          .select(`
            id, name, description, default_price, standard_hours, category_id, search_keywords, require_qc,
            service_categories(id, name)
          `)
          .order("name");
        if (error) {
          alert("加载项目失败: " + error.message);
          setAllServiceItems([]);
          return;
        }
        setAllServiceItems((items as unknown as ServiceItem[]) || []);
      } catch (err: unknown) {
        alert("加载项目失败: " + (err instanceof Error ? err.message : String(err)));
      } finally {
        setLoading(false);
      }
    }

    loadData();

    /* 加载车型定价 */
    if (vehicleModelId) {
      supabase
        .from("service_item_prices")
        .select("service_item_id, vehicle_model_id, price")
        .eq("vehicle_model_id", vehicleModelId)
        .then(({ data, error }) => {
          if (error) {
            console.error("加载车型定价失败:", error.message);
            return;
          }
          setServiceItemPrices((data as ServiceItemPrice[]) || []);
        });
    } else {
      setServiceItemPrices([]);
    }
  }, [open, supabase, vehicleModelId]);

  /* 获取车型定价价格 */
  function getVehiclePrice(serviceItemId: string): number | null {
    if (!vehicleModelId) return null;
    return serviceItemPrices.find(
      (p) => p.service_item_id === serviceItemId && p.vehicle_model_id === vehicleModelId
    )?.price ?? null;
  }

  const filteredList = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allServiceItems.filter((si) => {
      if (q) {
        const hay = [
          si.name,
          si.service_categories?.name,
          si.search_keywords,
          si.description,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allServiceItems, query]);

  const listToShow = filteredList.slice(0, 100);

  if (!open) return null;

  function toggle(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function handleClose() {
    if (saving) return;
    onClose();
  }

  async function handleBatchAdd() {
    if (selectedIds.length === 0) {
      alert("请至少勾选一个项目");
      return;
    }

    setSaving(true);
    try {
      const selected = selectedIds
        .map((id) => allServiceItems.find((s) => s.id === id))
        .filter(Boolean) as ServiceItem[];

      /* 查重 + 插入都在服务端完成（服务端重新查重，不信客户端旧列表） */
      const result = await 批量添加工单项目({
        orderId,
        requirementId,
        itemType: defaultType,
        items: selected.map((si) => ({
          service_item_id: si.id,
          name: si.name,
          description: si.description || null,
          unit_price: getVehiclePrice(si.id) ?? si.default_price ?? 0,
          require_qc: si.require_qc ?? false,
        })),
      });

      if (!result.success) {
        alert("批量添加失败: " + (result.error || "未知错误"));
        return;
      }

      const 新项目们 = result.items || [];
      const skippedNames = result.skippedNames || [];

      if (新项目们.length === 0) {
        alert("勾选的项目都已存在于当前工单，无需重复添加");
        return;
      }

      if (skippedNames.length > 0) {
        alert(`已添加 ${新项目们.length} 项；跳过 ${skippedNames.length} 个重复项目：${skippedNames.join("、")}`);
      }

      /* 局部更新：广播"wo-items-added"事件，需求下的 LiveItemsList 立即追加项目行、
       * WorkOrderTotalFooter 同步合计，不整页刷新（与配件添加同一模式）。
       * 整页刷新后服务端数据已含这些项目，追加行按 id 去重自动移除。 */
      onClose();
      if (新项目们.length > 0) {
        window.dispatchEvent(
          new CustomEvent("wo-items-added", {
            detail: { requirementId, items: 新项目们 },
          })
        );
      }
    } catch (err: unknown) {
      alert("批量添加失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50">
      <div className="bg-white rounded-t-xl md:rounded-xl shadow-2xl w-full md:max-w-3xl md:mx-4 flex flex-col h-[85vh] md:h-auto md:max-h-[85vh]">
        {/* 标题栏 */}
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900">批量选择维修项目</h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none disabled:opacity-50"
          >
            ×
          </button>
        </div>

        {/* 筛选栏 */}
        <div className="px-4 py-2 border-b border-gray-100 bg-gray-50 flex flex-col gap-2 flex-shrink-0">
          <input
            type="text"
            placeholder="搜索项目名称..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          {/* 常用快捷标签 */}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setQuery("")}
              className={`px-2 py-1 rounded-full text-xs border transition-colors ${
                query === "" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-400 hover:text-blue-600"
              }`}
            >
              全部
            </button>
            {QUICK_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setQuery(tag)}
                className={`px-2 py-1 rounded-full text-xs border transition-colors ${
                  query === tag ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-400 hover:text-blue-600"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* 列表 - 卡片布局 */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {loading ? (
            <div className="text-center text-gray-400 text-sm py-12">加载中...</div>
          ) : listToShow.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-12">未找到匹配的项目</div>
          ) : (
            <div className="space-y-2">
              {listToShow.map((si) => {
                const checked = selectedIds.includes(si.id);
                const vPrice = getVehiclePrice(si.id);
                return (
                  <div
                    key={si.id}
                    onClick={() => toggle(si.id)}
                    className={`border rounded-lg p-3 cursor-pointer transition-colors ${
                      checked ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="pt-0.5 flex-shrink-0">
                        <div
                          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                            checked
                              ? "bg-blue-600 border-blue-600"
                              : "border-gray-300 bg-white"
                          }`}
                        >
                          {checked && (
                            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" />
                            </svg>
                          )}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-gray-900 text-sm">{si.name}</span>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                            {si.service_categories?.name || "-"}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
                          <span className="text-blue-600 font-medium">
                            {vPrice != null ? `车型价¥${vPrice}` : si.default_price != null ? `销售价¥${si.default_price}` : "-"}
                          </span>
                          {si.standard_hours && (
                            <span>{si.standard_hours}工时</span>
                          )}
                        </div>
                        {si.description && (
                          <p className="mt-1 text-xs text-gray-400 line-clamp-2">{si.description}</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {filteredList.length > 100 && (
            <div className="text-center text-xs text-gray-400 py-2">
              共 {filteredList.length} 项，仅显示前 100 项，请输入关键词缩小范围
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50 flex-shrink-0">
          <div className="text-sm text-gray-600">
            已选 <span className="font-semibold text-blue-600">{selectedIds.length}</span> 项
          </div>
          <div className="flex gap-2">
            {selectedIds.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                disabled={saving}
                className="px-3 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                清空
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              disabled={saving}
              className="px-3 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleBatchAdd}
              disabled={selectedIds.length === 0 || saving}
              className="px-3 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "添加中..." : `添加 (${selectedIds.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
