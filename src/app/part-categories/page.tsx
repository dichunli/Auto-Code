"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { DeleteButton } from "./DeleteButton";

export default function PartCategoriesPage() {
  const supabase = createClient();
  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

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
  });

  const loadCategories = useCallback(
    async (search?: string) => {
      setSearching(!!search);
      let q = supabase
        .from("part_categories")
        .select("*")
        .order("created_at", { ascending: false });
      if (search?.trim()) {
        q = q.ilike("name", `%${search.trim()}%`);
      }
      const { data } = await q;
      setCategories(data || []);
      setLoading(false);
      setSearching(false);
    },
    [supabase]
  );

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    const t = setTimeout(() => loadCategories(query), 300);
    return () => clearTimeout(t);
  }, [query, loadCategories]);

  function formatCommission(type: string | null, value: number | null) {
    if (!type || value == null) return "-";
    if (type === "revenue_pct") return `${value}% (产值)`;
    if (type === "profit_pct") return `${value}% (毛利)`;
    return `¥${value} (固定)`;
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

    const { error } = await supabase.from("part_categories").insert({
      name: form.name.trim(),
      auto_link_vehicle_model: form.auto_link_vehicle_model,
      is_consumable: form.is_consumable,
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

  return (
    <div>
      <PageHeader
        title="配件分类"
        description="管理分类、耗材属性及各类提成标准"
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
                <th className="px-6 py-3 text-left font-medium text-gray-500">销售提成</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">诊断提成</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">施工提成</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">质检提成</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">领料提成</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {categories?.map((c: any) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{c.name}</td>
                  <td className="px-6 py-4 text-gray-600">{c.auto_link_vehicle_model ? "是" : "否"}</td>
                  <td className="px-6 py-4 text-gray-600">{c.is_consumable ? "是" : "否"}</td>
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
                  <td colSpan={9} className="px-6 py-12 text-center">
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

            <div className="flex gap-6">
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
            </div>

            <div className="border-t border-gray-100 pt-4">
              <h3 className="text-base font-semibold text-gray-900 mb-4">提成标准配置</h3>
              <div className="space-y-4">
                <CommissionField label="销售提成" typeValue={form.sales_type} valueValue={form.sales_value} onTypeChange={(v) => setForm({ ...form, sales_type: v as any, sales_value: v ? form.sales_value : "" })} onValueChange={(v) => setForm({ ...form, sales_value: v })} />
                <CommissionField label="诊断提成" typeValue={form.diagnosis_type} valueValue={form.diagnosis_value} onTypeChange={(v) => setForm({ ...form, diagnosis_type: v as any, diagnosis_value: v ? form.diagnosis_value : "" })} onValueChange={(v) => setForm({ ...form, diagnosis_value: v })} />
                <CommissionField label="施工提成" typeValue={form.repair_type} valueValue={form.repair_value} onTypeChange={(v) => setForm({ ...form, repair_type: v as any, repair_value: v ? form.repair_value : "" })} onValueChange={(v) => setForm({ ...form, repair_value: v })} />
                <CommissionField label="质检提成" typeValue={form.qc_type} valueValue={form.qc_value} onTypeChange={(v) => setForm({ ...form, qc_type: v as any, qc_value: v ? form.qc_value : "" })} onValueChange={(v) => setForm({ ...form, qc_value: v })} />
                <CommissionField label="领料提成" typeValue={form.picking_type} valueValue={form.picking_value} onTypeChange={(v) => setForm({ ...form, picking_type: v as any, picking_value: v ? form.picking_value : "" })} onValueChange={(v) => setForm({ ...form, picking_value: v })} />
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
