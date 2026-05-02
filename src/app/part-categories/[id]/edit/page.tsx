"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export default function EditPartCategoryPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

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

  useEffect(() => {
    supabase
      .from("part_categories")
      .select("*")
      .eq("id", id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          alert("加载失败: " + (error?.message || "分类不存在"));
          router.push("/part-categories");
          return;
        }
        setForm({
          name: data.name || "",
          auto_link_vehicle_model: data.auto_link_vehicle_model || false,
          is_consumable: data.is_consumable || false,
          sales_type: data.sales_commission_type || "",
          sales_value: data.sales_commission_value?.toString() || "",
          diagnosis_type: data.diagnosis_commission_type || "",
          diagnosis_value: data.diagnosis_commission_value?.toString() || "",
          repair_type: data.repair_commission_type || "",
          repair_value: data.repair_commission_value?.toString() || "",
          qc_type: data.qc_commission_type || "",
          qc_value: data.qc_commission_value?.toString() || "",
          picking_type: data.picking_commission_type || "",
          picking_value: data.picking_commission_value?.toString() || "",
        });
        setLoading(false);
      });
  }, [id, supabase, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const { error } = await supabase
      .from("part_categories")
      .update({
        name: form.name,
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
      })
      .eq("id", id);

    if (error) {
      alert("保存失败: " + error.message);
      setSaving(false);
      return;
    }

    router.push("/part-categories");
    router.refresh();
  }

  async function handleSync() {
    if (!confirm("确定要将当前分类的属性同步到所有使用该分类的配件名称和配件吗？此操作会覆盖这些配件名称及配件的现有属性设置。")) return;
    setSyncing(true);

    const updateData = {
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
    };

    const { error: nameError } = await supabase.from("part_names").update(updateData).eq("category_id", id);
    if (nameError) { alert("同步配件名称失败: " + nameError.message); setSyncing(false); return; }

    const { error: partError } = await supabase.from("parts").update(updateData).eq("category_id", id);
    if (partError) { alert("同步配件失败: " + partError.message); setSyncing(false); return; }

    alert("同步成功");
    setSyncing(false);
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

  if (loading) {
    return (
      <div>
        <PageHeader title="编辑配件分类" />
        <div className="text-sm text-gray-500 py-8">加载中...</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="编辑配件分类" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
        <div className="space-y-6">
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
            <h2 className="text-base font-semibold text-gray-900 mb-4">提成标准配置</h2>
            <div className="space-y-4">
              <CommissionField
                label="销售提成"
                typeValue={form.sales_type}
                valueValue={form.sales_value}
                onTypeChange={(v) => setForm({ ...form, sales_type: v as any, sales_value: v ? form.sales_value : "" })}
                onValueChange={(v) => setForm({ ...form, sales_value: v })}
              />
              <CommissionField
                label="诊断提成"
                typeValue={form.diagnosis_type}
                valueValue={form.diagnosis_value}
                onTypeChange={(v) => setForm({ ...form, diagnosis_type: v as any, diagnosis_value: v ? form.diagnosis_value : "" })}
                onValueChange={(v) => setForm({ ...form, diagnosis_value: v })}
              />
              <CommissionField
                label="施工提成"
                typeValue={form.repair_type}
                valueValue={form.repair_value}
                onTypeChange={(v) => setForm({ ...form, repair_type: v as any, repair_value: v ? form.repair_value : "" })}
                onValueChange={(v) => setForm({ ...form, repair_value: v })}
              />
              <CommissionField
                label="质检提成"
                typeValue={form.qc_type}
                valueValue={form.qc_value}
                onTypeChange={(v) => setForm({ ...form, qc_type: v as any, qc_value: v ? form.qc_value : "" })}
                onValueChange={(v) => setForm({ ...form, qc_value: v })}
              />
              <CommissionField
                label="领料提成"
                typeValue={form.picking_type}
                valueValue={form.picking_value}
                onTypeChange={(v) => setForm({ ...form, picking_type: v as any, picking_value: v ? form.picking_value : "" })}
                onValueChange={(v) => setForm({ ...form, picking_value: v })}
              />
            </div>
          </div>
        </div>

        <div className="mt-8 flex gap-3 justify-end">
          <button
            type="button"
            onClick={() => router.push("/part-categories")}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 text-sm font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 disabled:opacity-50"
          >
            {syncing ? "同步中..." : "同步到配件"}
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
  );
}
