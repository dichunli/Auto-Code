"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Props {
  open: boolean;
  onClose: () => void;
  orderId: string;
  requirementId: string;
}

type ServiceItem = {
  id: string;
  name: string;
  description: string | null;
  default_price: number | null;
  standard_hours: number | null;
  category_id: string | null;
  service_name_id: string | null;
  service_categories?: { id: string; name: string } | null;
  service_names?: { id: string; name: string; search_keywords: string | null; category_id: string } | null;
};

type Category = { id: string; name: string };

export default function ItemBatchPickerModal({ open, onClose, orderId, requirementId }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [allServiceItems, setAllServiceItems] = useState<ServiceItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [defaultType, setDefaultType] = useState<"labor" | "part" | "other">("labor");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCategoryFilter("");
    setDefaultType("labor");
    setSelectedIds([]);

    async function loadData() {
      setLoading(true);
      try {
        const [{ data: items }, { data: cats }] = await Promise.all([
          supabase
            .from("service_items")
            .select(`
              id, name, description, default_price, standard_hours, category_id, service_name_id,
              service_categories(id, name),
              service_names(id, name, search_keywords, category_id)
            `)
            .order("name"),
          supabase.from("service_categories").select("id, name").order("name"),
        ]);
        setAllServiceItems((items as any) || []);
        setCategories((cats as any) || []);
      } catch (err: any) {
        alert("加载项目失败: " + (err.message || err));
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [open, supabase]);

  const filteredList = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allServiceItems.filter((si) => {
      if (categoryFilter) {
        const catId = si.service_names?.category_id || si.category_id;
        if (catId !== categoryFilter) return false;
      }
      if (q) {
        const hay = [
          si.name,
          si.service_categories?.name,
          si.service_names?.name,
          si.service_names?.search_keywords,
          si.description,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allServiceItems, query, categoryFilter]);

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
      const { data: existingItems } = await supabase
        .from("work_order_items")
        .select("name")
        .eq("work_order_id", orderId);
      const existingNames = new Set((existingItems || []).map((it: any) => it.name));

      const selected = selectedIds
        .map((id) => allServiceItems.find((s) => s.id === id))
        .filter(Boolean) as ServiceItem[];

      const toInsert = selected.filter((si) => !existingNames.has(si.name));
      const duplicates = selected.filter((si) => existingNames.has(si.name));

      if (toInsert.length === 0) {
        alert("勾选的项目都已存在于当前工单，无需重复添加");
        setSaving(false);
        return;
      }

      const records = toInsert.map((si) => ({
        work_order_id: orderId,
        requirement_id: requirementId,
        service_item_id: si.id,
        name: si.name,
        item_type: defaultType,
        description: si.description || null,
        quantity: 1,
        unit_price: si.default_price ?? 0,
      }));

      const { error } = await supabase.from("work_order_items").insert(records);
      if (error) throw error;

      if (duplicates.length > 0) {
        alert(`已添加 ${toInsert.length} 项；跳过 ${duplicates.length} 个重复项目：${duplicates.map((d) => d.name).join("、")}`);
      }

      onClose();
      router.refresh();
    } catch (err: any) {
      alert("批量添加失败: " + (err.message || err));
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
          <div className="flex gap-2">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
            >
              <option value="">全部分类</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select
              value={defaultType}
              onChange={(e) => setDefaultType(e.target.value as any)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
            >
              <option value="labor">工时</option>
              <option value="part">配件</option>
              <option value="other">其他</option>
            </select>
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
                          {si.service_names?.name && (
                            <span>名称库: {si.service_names.name}</span>
                          )}
                          <span className="text-blue-600 font-medium">
                            {si.default_price != null ? `¥${si.default_price}` : "-"}
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
