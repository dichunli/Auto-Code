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
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCategoryFilter("");
    setDefaultType("labor");
    setSelectedIds([]);

    async function loadData() {
      setLoading(true);
      try {
        const [{ data: items }, { data: cats }, { data: { user } }] = await Promise.all([
          supabase
            .from("service_items")
            .select(`
              id, name, description, default_price, standard_hours, category_id, service_name_id,
              service_categories(id, name),
              service_names(id, name, search_keywords, category_id)
            `)
            .order("name"),
          supabase.from("service_categories").select("id, name").order("name"),
          supabase.auth.getUser(),
        ]);
        setAllServiceItems((items as any) || []);
        setCategories((cats as any) || []);
        setCurrentUserId(user?.id || null);
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

  const listToShow = filteredList.slice(0, 200);

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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto py-8">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl mx-4 flex flex-col" style={{ maxHeight: "85vh" }}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">批量选择维修项目</h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none disabled:opacity-50"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="搜索项目名称、搜索字段、备注..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
          >
            <option value="">全部分类</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            value={defaultType}
            onChange={(e) => setDefaultType(e.target.value as any)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
            title="新增行的默认类型"
          >
            <option value="labor">默认类型: 工时</option>
            <option value="part">默认类型: 配件</option>
            <option value="other">默认类型: 其他</option>
          </select>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="text-center text-gray-400 text-sm py-12">加载中...</div>
          ) : listToShow.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-12">未找到匹配的项目</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left w-10">选</th>
                  <th className="px-3 py-2 text-left">项目名称</th>
                  <th className="px-3 py-2 text-left w-24">分类</th>
                  <th className="px-3 py-2 text-left w-28">名称库</th>
                  <th className="px-3 py-2 text-left w-16">类型</th>
                  <th className="px-3 py-2 text-right w-20">单价</th>
                  <th className="px-3 py-2 text-left">备注</th>
                </tr>
              </thead>
              <tbody>
                {listToShow.map((si) => {
                  const checked = selectedIds.includes(si.id);
                  return (
                    <tr
                      key={si.id}
                      className={`border-b border-gray-100 cursor-pointer ${checked ? "bg-blue-50" : "hover:bg-gray-50"}`}
                      onClick={() => toggle(si.id)}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(si.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-900">{si.name}</td>
                      <td className="px-3 py-2 text-gray-600">{si.service_categories?.name || "-"}</td>
                      <td className="px-3 py-2 text-gray-600">{si.service_names?.name || "-"}</td>
                      <td className="px-3 py-2 text-gray-600">工时</td>
                      <td className="px-3 py-2 text-right text-blue-600">
                        {si.default_price != null ? `${si.default_price}` : "-"}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500 truncate max-w-xs" title={si.description || ""}>
                        {si.description || "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {filteredList.length > 200 && (
            <div className="text-center text-xs text-gray-400 py-2">
              共 {filteredList.length} 项，仅显示前 200 项，请输入关键词缩小范围
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50">
          <div className="text-sm text-gray-600">
            已选 <span className="font-semibold text-blue-600">{selectedIds.length}</span> 项
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              disabled={selectedIds.length === 0 || saving}
              className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              清空选择
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={saving}
              className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleBatchAdd}
              disabled={selectedIds.length === 0 || saving}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "添加中..." : `批量添加 (${selectedIds.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
