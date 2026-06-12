"use client";

import {useState, useEffect, useMemo, useRef} from "react";
import { createClient } from "@/lib/supabase/client";
import { useDebounce } from "@/lib/useDebounce";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { DeleteButton } from "./DeleteButton";

interface 配件分类 {
  id: string;
  name: string;
  auto_link_vehicle_model: boolean;
  is_consumable: boolean;
  sales_commission_type: string | null;
  sales_commission_value: number | null;
  diagnosis_commission_type: string | null;
  diagnosis_commission_value: number | null;
  repair_commission_type: string | null;
  repair_commission_value: number | null;
  qc_commission_type: string | null;
  qc_commission_value: number | null;
  picking_commission_type: string | null;
  picking_commission_value: number | null;
  require_scan_check: boolean;
  require_location_check: boolean;
  sort_order: number;
  created_at: string;
}

function CommissionField({
  label,
  typeValue,
  valueValue,
  onTypeChange,
  onValueChange,
}: {
  label: string;
  typeValue: string;
  valueValue: string;
  onTypeChange: (v: string) => void;
  onValueChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-xs text-gray-500 mb-1">{label}方式</label>
        <select
          className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm"
          value={typeValue}
          onChange={(e) => onTypeChange(e.target.value)}
        >
          <option value="">无提成</option>
          <option value="revenue_pct">按产值(%)</option>
          <option value="profit_pct">按毛利(%)</option>
          <option value="fixed">固定金额</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">{label}数值</label>
        <input
          type="number"
          className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm"
          value={valueValue}
          onChange={(e) => onValueChange(e.target.value)}
          disabled={!typeValue}
        />
      </div>
    </div>
  );
}

export default function PartCategoriesContent({ initialCategories }: { initialCategories: 配件分类[] }) {
  const supabase = useMemo(() => createClient(), []);
  const 跳过首次查询 = useRef(true);
  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState<配件分类[]>(initialCategories);
  const [, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [sortSaving, setSortSaving] = useState(false);
  const debouncedQuery = useDebounce(query, 300);

  const [form, setForm] = useState({
    name: "",
    auto_link_vehicle_model: false,
    is_consumable: false,
    sales_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    sales_value: "",
    diagnosis_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    diagnosis_value: "",
    repair_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    repair_value: "",
    qc_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    qc_value: "",
    picking_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    picking_value: "",
    require_scan_check: false,
    require_location_check: false,
  });

  async function loadCategories(search?: string) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setSearching(!!search);
    let q = supabase
      .from("part_categories")
      .select("*")
      .order("sort_order", { ascending: true });
    if (search?.trim()) {
      q = q.ilike("name", `%${search.trim()}%`);
    }
    const { data } = await q;
    setCategories(data || []);
    setLoading(false);
    setSearching(false);
  }

  useEffect(() => {
    if (跳过首次查询.current) { 跳过首次查询.current = false; return; }
    loadCategories(debouncedQuery);
  }, [debouncedQuery]);

  function formatCommission(type: string | null, value: number | null) {
    if (!type || value == null) return "-";
    if (type === "revenue_pct") return `${value}% (产值)`;
    if (type === "profit_pct") return `${value}% (毛利)`;
    return `¥${value} (固定)`;
  }

  /* 拖拽排序 */
  function handleDragStart(e: React.DragEvent, id: string) {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }

  function handleDragOver(e: React.DragEvent, id: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (id !== draggingId) {
      setDragOverId(id);
    }
  }

  function handleDragLeave() {
    setDragOverId(null);
  }

  async function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    setDragOverId(null);
    setDraggingId(null);

    const sourceId = e.dataTransfer.getData("text/plain");
    if (!sourceId || sourceId === targetId) return;

    const sourceIndex = categories.findIndex((c) => c.id === sourceId);
    const targetIndex = categories.findIndex((c) => c.id === targetId);
    if (sourceIndex === -1 || targetIndex === -1) return;

    const newCategories = [...categories];
    const [removed] = newCategories.splice(sourceIndex, 1);
    newCategories.splice(targetIndex, 0, removed);
    setCategories(newCategories);

    /* 保存到数据库 */
    setSortSaving(true);
    for (let i = 0; i < newCategories.length; i++) {
      const { error } = await supabase
        .from("part_categories")
        .update({ sort_order: i + 1 })
        .eq("id", newCategories[i].id);
      if (error) {
        console.error("保存排序失败:", error);
      }
    }
    setSortSaving(false);
  }

  function handleDragEnd() {
    setDraggingId(null);
    setDragOverId(null);
  }

  function handleStartCreate() {
    setForm((prev) => ({ ...prev, name: query.trim() }));
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      alert("请输入分类名称");
      return;
    }
    setSaving(true);

    const maxSort = categories.length > 0
      ? Math.max(...categories.map((c) => c.sort_order || 0))
      : 0;

    const { error } = await supabase.from("part_categories").insert({
      name: form.name.trim(),
      sort_order: maxSort + 1,
      auto_link_vehicle_model: form.auto_link_vehicle_model,
      is_consumable: form.is_consumable,
      require_scan_check: form.require_scan_check,
      require_location_check: form.require_location_check,
      sales_commission_type: form.sales_type || null,
      sales_commission_value: form.sales_value ? parseFloat(form.sales_value) : null,
      diagnosis_commission_type: form.diagnosis_type || null,
      diagnosis_commission_value: form.diagnosis_value ? parseFloat(form.diagnosis_value) : null,
      repair_commission_type: form.repair_type || null,
      repair_commission_value: form.repair_value ? parseFloat(form.repair_value) : null,
      qc_commission_type: form.qc_type || null,
      qc_commission_value: form.qc_value ? parseFloat(form.qc_value) : null,
      picking_commission_type: form.picking_type || null,
      picking_commission_value: form.picking_value ? parseFloat(form.picking_value) : null,
    });

    if (error) {
      alert("保存失败: " + error.message);
      setSaving(false);
      return;
    }

    setShowForm(false);
    setQuery("");
    setForm({
      name: "",
      auto_link_vehicle_model: false,
      is_consumable: false,
      require_scan_check: false,
      require_location_check: false,
      sales_type: "",
      sales_value: "",
      diagnosis_type: "",
      diagnosis_value: "",
      repair_type: "",
      repair_value: "",
      qc_type: "",
      qc_value: "",
      picking_type: "",
      picking_value: "",
    });
    loadCategories("");
    setSaving(false);
  }

  return (
    <div>
      <PageHeader
        title="配件分类"
        description={`管理分类、耗材属性及各类提成标准${sortSaving ? "（保存排序中...）" : ""}`}
      />

      <div className="mb-4 flex gap-2">
        <input
          className="w-1/4 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="搜索分类名称..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query.trim() && (
          <button
            onClick={() => setQuery("")}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            清空
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">分类名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">自动关联车型</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">耗材</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">扫码出库</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">入库仓位</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">销售提成</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">诊断提成</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">施工提成</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">质检提成</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">领料提成</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {categories?.map((c: 配件分类) => (
                <tr
                  key={c.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, c.id)}
                  onDragOver={(e) => handleDragOver(e, c.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, c.id)}
                  onDragEnd={handleDragEnd}
                  className={`hover:bg-gray-50 cursor-move transition-colors ${
                    draggingId === c.id ? "opacity-50 bg-blue-50" : ""
                  } ${dragOverId === c.id && dragOverId !== draggingId ? "border-t-2 border-blue-400 bg-blue-50" : ""}`}
                  title="拖动可排序"
                >
                  <td className="px-6 py-4 font-medium text-gray-900">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                      </svg>
                      {c.name}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{c.auto_link_vehicle_model ? "是" : "否"}</td>
                  <td className="px-6 py-4 text-gray-600">{c.is_consumable ? "是" : "否"}</td>
                  <td className="px-6 py-4 text-gray-600">{c.require_scan_check ? "是" : "否"}</td>
                  <td className="px-6 py-4 text-gray-600">{c.require_location_check ? "是" : "否"}</td>
                  <td className="px-6 py-4 text-gray-600">{formatCommission(c.sales_commission_type, c.sales_commission_value)}</td>
                  <td className="px-6 py-4 text-gray-600">{formatCommission(c.diagnosis_commission_type, c.diagnosis_commission_value)}</td>
                  <td className="px-6 py-4 text-gray-600">{formatCommission(c.repair_commission_type, c.repair_commission_value)}</td>
                  <td className="px-6 py-4 text-gray-600">{formatCommission(c.qc_commission_type, c.qc_commission_value)}</td>
                  <td className="px-6 py-4 text-gray-600">{formatCommission(c.picking_commission_type, c.picking_commission_value)}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Link href={`/part-categories/${c.id}/edit`} className="text-sm text-blue-600 hover:text-blue-700 font-medium">编辑</Link>
                      <DeleteButton id={c.id} name={c.name} />
                    </div>
                  </td>
                </tr>
              ))}
              {(!categories || categories.length === 0) && !showForm && (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center">
                    <div className="text-gray-400 mb-4">
                      {searching ? "搜索中..." : query.trim() ? "未找到匹配的分类" : "暂无分类"}
                    </div>
                    <button
                      onClick={handleStartCreate}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                    >
                      新建分类
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="mt-6 bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
          <h2 className="text-base font-semibold text-gray-900 mb-4">新建配件分类</h2>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">分类名称 *</label>
              <input
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div className="flex gap-6 flex-wrap">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.auto_link_vehicle_model}
                  onChange={(e) => setForm({ ...form, auto_link_vehicle_model: e.target.checked })}
                  className="w-4 h-4"
                />
                <span className="text-sm text-gray-700">自动关联车型</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_consumable}
                  onChange={(e) => setForm({ ...form, is_consumable: e.target.checked })}
                  className="w-4 h-4"
                />
                <span className="text-sm text-gray-700">耗材（出库不计入营业额）</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer" title="勾选后，该分类下的配件出库时需要库管扫码确认">
                <input
                  type="checkbox"
                  checked={form.require_scan_check}
                  onChange={(e) => setForm({ ...form, require_scan_check: e.target.checked })}
                  className="w-4 h-4"
                />
                <span className="text-sm text-gray-700">扫码出库确认</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer" title="勾选后，该分类下的配件入库时必须填写/确认存放位置">
                <input
                  type="checkbox"
                  checked={form.require_location_check}
                  onChange={(e) => setForm({ ...form, require_location_check: e.target.checked })}
                  className="w-4 h-4"
                />
                <span className="text-sm text-gray-700">入库仓位确认</span>
              </label>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <h3 className="text-base font-semibold text-gray-900 mb-4">提成标准配置</h3>
              <div className="space-y-4">
                <CommissionField label="销售提成" typeValue={form.sales_type} valueValue={form.sales_value} onTypeChange={(v) => setForm({ ...form, sales_type: v as "" | "revenue_pct" | "profit_pct" | "fixed", sales_value: v ? form.sales_value : "" })} onValueChange={(v) => setForm({ ...form, sales_value: v })} />
                <CommissionField label="诊断提成" typeValue={form.diagnosis_type} valueValue={form.diagnosis_value} onTypeChange={(v) => setForm({ ...form, diagnosis_type: v as "" | "revenue_pct" | "profit_pct" | "fixed", diagnosis_value: v ? form.diagnosis_value : "" })} onValueChange={(v) => setForm({ ...form, diagnosis_value: v })} />
                <CommissionField label="施工提成" typeValue={form.repair_type} valueValue={form.repair_value} onTypeChange={(v) => setForm({ ...form, repair_type: v as "" | "revenue_pct" | "profit_pct" | "fixed", repair_value: v ? form.repair_value : "" })} onValueChange={(v) => setForm({ ...form, repair_value: v })} />
                <CommissionField label="质检提成" typeValue={form.qc_type} valueValue={form.qc_value} onTypeChange={(v) => setForm({ ...form, qc_type: v as "" | "revenue_pct" | "profit_pct" | "fixed", qc_value: v ? form.qc_value : "" })} onValueChange={(v) => setForm({ ...form, qc_value: v })} />
                <CommissionField label="领料提成" typeValue={form.picking_type} valueValue={form.picking_value} onTypeChange={(v) => setForm({ ...form, picking_type: v as "" | "revenue_pct" | "profit_pct" | "fixed", picking_value: v ? form.picking_value : "" })} onValueChange={(v) => setForm({ ...form, picking_value: v })} />
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
