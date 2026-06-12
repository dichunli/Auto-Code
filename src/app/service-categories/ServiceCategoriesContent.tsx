"use client";

import {useState, useMemo} from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DeleteButton } from "./DeleteButton";

interface 维修分类 {
  id: string;
  name: string;
  sort_order: number;
  sales_commission_type: string | null;
  sales_commission_value: number | null;
  diagnosis_commission_type: string | null;
  diagnosis_commission_value: number | null;
  repair_commission_type: string | null;
  repair_commission_value: number | null;
  qc_commission_type: string | null;
  qc_commission_value: number | null;
  dispatch_commission_type: string | null;
  dispatch_commission_value: number | null;
  claim_commission_type: string | null;
  claim_commission_value: number | null;
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

export default function ServiceCategoriesContent({ initialCategories }: { initialCategories: 维修分类[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [categories, setCategories] = useState<维修分类[]>(initialCategories);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  /* 拖动排序状态 */
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);

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
    dispatch_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    dispatch_value: "",
    claim_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    claim_value: "",
  });

  async function load() {
    const { data } = await supabase
      .from("service_categories")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    setCategories(data || []);
  }

  function formatCommission(type: string | null, value: number | null) {
    if (!type || value == null) return "-";
    if (type === "revenue_pct") return `${value}% (产值)`;
    if (type === "profit_pct") return `${value}% (毛利)`;
    return `¥${value} (固定)`;
  }

  function handleDragStart(e: React.DragEvent<HTMLTableRowElement>, id: string) {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }

  function handleDragOver(e: React.DragEvent<HTMLTableRowElement>, id: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (id !== draggingId) {
      setDragOverId(id);
    }
  }

  function handleDragLeave() {
    setDragOverId(null);
  }

  async function handleDrop(e: React.DragEvent<HTMLTableRowElement>, targetId: string) {
    e.preventDefault();
    setDragOverId(null);
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      return;
    }

    const fromIndex = categories.findIndex((c) => c.id === draggingId);
    const toIndex = categories.findIndex((c) => c.id === targetId);
    if (fromIndex === -1 || toIndex === -1) {
      setDraggingId(null);
      return;
    }

    const newList = [...categories];
    const [moved] = newList.splice(fromIndex, 1);
    newList.splice(toIndex, 0, moved);
    setCategories(newList);
    setDraggingId(null);

    /* 批量更新 sort_order */
    await saveSortOrder(newList);
  }

  function handleDragEnd() {
    setDraggingId(null);
    setDragOverId(null);
  }

  async function saveSortOrder(list: 维修分类[]) {
    setSavingOrder(true);
    try {
      const updates = list.map((item, index) =>
        supabase.from("service_categories").update({ sort_order: index }).eq("id", item.id)
      );
      const results = await Promise.all(updates);
      const errors = results.filter((r) => r.error);
      if (errors.length > 0) {
        alert("排序保存失败: " + errors[0].error?.message);
        await load();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "未知错误";
      alert("排序保存失败: " + msg);
      await load();
    } finally {
      setSavingOrder(false);
    }
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
      dispatch_commission_type: form.dispatch_type || null,
      dispatch_commission_value: form.dispatch_value ? parseFloat(form.dispatch_value) : null,
      claim_commission_type: form.claim_type || null,
      claim_commission_value: form.claim_value ? parseFloat(form.claim_value) : null,
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
      dispatch_type: "",
      dispatch_value: "",
      claim_type: "",
      claim_value: "",
    });
    setShowForm(false);
    await load();
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
                  onTypeChange={(v) => setForm({ ...form, sales_type: v as "" | "revenue_pct" | "profit_pct" | "fixed" })}
                  onValueChange={(v) => setForm({ ...form, sales_value: v })}
                />
                <CommissionField
                  label="诊断提成"
                  typeValue={form.diagnosis_type}
                  valueValue={form.diagnosis_value}
                  onTypeChange={(v) => setForm({ ...form, diagnosis_type: v as "" | "revenue_pct" | "profit_pct" | "fixed" })}
                  onValueChange={(v) => setForm({ ...form, diagnosis_value: v })}
                />
                <CommissionField
                  label="施工提成"
                  typeValue={form.repair_type}
                  valueValue={form.repair_value}
                  onTypeChange={(v) => setForm({ ...form, repair_type: v as "" | "revenue_pct" | "profit_pct" | "fixed" })}
                  onValueChange={(v) => setForm({ ...form, repair_value: v })}
                />
                <CommissionField
                  label="质检提成"
                  typeValue={form.qc_type}
                  valueValue={form.qc_value}
                  onTypeChange={(v) => setForm({ ...form, qc_type: v as "" | "revenue_pct" | "profit_pct" | "fixed" })}
                  onValueChange={(v) => setForm({ ...form, qc_value: v })}
                />
                <CommissionField
                  label="派单提成"
                  typeValue={form.dispatch_type}
                  valueValue={form.dispatch_value}
                  onTypeChange={(v) => setForm({ ...form, dispatch_type: v as "" | "revenue_pct" | "profit_pct" | "fixed" })}
                  onValueChange={(v) => setForm({ ...form, dispatch_value: v })}
                />
                <CommissionField
                  label="领单提成"
                  typeValue={form.claim_type}
                  valueValue={form.claim_value}
                  onTypeChange={(v) => setForm({ ...form, claim_type: v as "" | "revenue_pct" | "profit_pct" | "fixed" })}
                  onValueChange={(v) => setForm({ ...form, claim_value: v })}
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

      {categories.length > 1 && (
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs text-gray-500">
            <svg className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
            </svg>
            按住左侧图标拖动行可调整分类排序
          </p>
          {savingOrder && (
            <span className="text-xs text-blue-600">正在保存排序...</span>
          )}
        </div>
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
                <th className="px-6 py-3 text-left font-medium text-gray-500">派单提成</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">领单提成</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {categories?.map((c: 维修分类) => (
                <tr
                  key={c.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, c.id)}
                  onDragOver={(e) => handleDragOver(e, c.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, c.id)}
                  onDragEnd={handleDragEnd}
                  className={`hover:bg-gray-50 transition-colors cursor-move select-none ${
                    draggingId === c.id ? "opacity-50 bg-blue-50" : ""
                  } ${dragOverId === c.id && dragOverId !== draggingId ? "border-t-2 border-blue-500 bg-blue-50" : ""}`}
                >
                  <td className="px-6 py-4 font-medium text-gray-900">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                      </svg>
                      {c.name}
                    </div>
                  </td>
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
                  <td className="px-6 py-4 text-gray-600">
                    {formatCommission(c.dispatch_commission_type, c.dispatch_commission_value)}
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {formatCommission(c.claim_commission_type, c.claim_commission_value)}
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
                    colSpan={8}
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
