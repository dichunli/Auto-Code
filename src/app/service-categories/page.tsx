"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DeleteButton } from "./DeleteButton";

export default function ServiceCategoriesPage() {
  const supabase = createClient();
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "",
    sales_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    sales_value: "",
    diagnosis_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    diagnosis_value: "",
    repair_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    repair_value: "",
    qc_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    qc_value: "",
  });

  async function load() {
    const { data } = await supabase
      .from("service_categories")
      .select("*")
      .order("created_at", { ascending: false });
    setCategories(data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [supabase]);

  function formatCommission(type: string | null, value: number | null) {
    if (!type || value == null) return "-";
    if (type === "revenue_pct") return `${value}% (产值)`;
    if (type === "profit_pct") return `${value}% (毛利)`;
    return `¥${value} (固定)`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      alert("请填写分类名称");
      return;
    }
    setSaving(true);

    // 查重
    const { data: dup } = await supabase
      .from("service_categories")
      .select("id")
      .ilike("name", form.name.trim())
      .maybeSingle();
    if (dup) {
      alert("该分类名称已存在，请更换");
      setSaving(false);
      return;
    }

    const { error } = await supabase.from("service_categories").insert({
      name: form.name.trim(),
      sales_commission_type: form.sales_type || null,
      sales_commission_value: form.sales_value ? parseFloat(form.sales_value) : null,
      diagnosis_commission_type: form.diagnosis_type || null,
      diagnosis_commission_value: form.diagnosis_value ? parseFloat(form.diagnosis_value) : null,
      repair_commission_type: form.repair_type || null,
      repair_commission_value: form.repair_value ? parseFloat(form.repair_value) : null,
      qc_commission_type: form.qc_type || null,
      qc_commission_value: form.qc_value ? parseFloat(form.qc_value) : null,
    });

    if (error) {
      alert("保存失败: " + error.message);
      setSaving(false);
      return;
    }

    setForm({
      name: "",
      sales_type: "",
      sales_value: "",
      diagnosis_type: "",
      diagnosis_value: "",
      repair_type: "",
      repair_value: "",
      qc_type: "",
      qc_value: "",
    });
    setShowForm(false);
    await load();
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
        title="维修项目分类"
        description="管理分类及各类提成标准"
        action={{
          href: "#",
          label: showForm ? "收起新建" : "新建分类",
          onClick: () => setShowForm((s) => !s),
        }}
      />

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 bg-white rounded-xl border border-gray-200 p-6 max-w-2xl"
        >
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">分类名称 *</label>
              <input
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="如：保养、机修、钣金"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div className="border-t border-gray-100 pt-4">
              <h2 className="text-base font-semibold text-gray-900 mb-4">提成标准配置</h2>
              <div className="space-y-4">
                <CommissionField
                  label="销售提成"
                  typeValue={form.sales_type}
                  valueValue={form.sales_value}
                  onTypeChange={(v) => setForm({ ...form, sales_type: v as any })}
                  onValueChange={(v) => setForm({ ...form, sales_value: v })}
                />
                <CommissionField
                  label="诊断提成"
                  typeValue={form.diagnosis_type}
                  valueValue={form.diagnosis_value}
                  onTypeChange={(v) => setForm({ ...form, diagnosis_type: v as any })}
                  onValueChange={(v) => setForm({ ...form, diagnosis_value: v })}
                />
                <CommissionField
                  label="施工提成"
                  typeValue={form.repair_type}
                  valueValue={form.repair_value}
                  onTypeChange={(v) => setForm({ ...form, repair_type: v as any })}
                  onValueChange={(v) => setForm({ ...form, repair_value: v })}
                />
                <CommissionField
                  label="质检提成"
                  typeValue={form.qc_type}
                  valueValue={form.qc_value}
                  onTypeChange={(v) => setForm({ ...form, qc_type: v as any })}
                  onValueChange={(v) => setForm({ ...form, qc_value: v })}
                />
              </div>
            </div>
          </div>

          <div className="mt-6 flex gap-3 justify-end">
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
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">分类名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">销售提成</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">诊断提成</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">施工提成</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">质检提成</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {categories?.map((c: any) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{c.name}</td>
                  <td className="px-6 py-4 text-gray-600">
                    {formatCommission(c.sales_commission_type, c.sales_commission_value)}
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {formatCommission(c.diagnosis_commission_type, c.diagnosis_commission_value)}
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {formatCommission(c.repair_commission_type, c.repair_commission_value)}
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {formatCommission(c.qc_commission_type, c.qc_commission_value)}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/service-categories/${c.id}/edit`}
                        className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        编辑
                      </Link>
                      <DeleteButton id={c.id} name={c.name} />
                    </div>
                  </td>
                </tr>
              ))}
              {(!categories || categories.length === 0) && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-12 text-center text-gray-400"
                  >
                    暂无分类，请先新建
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
