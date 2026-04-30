"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export default function NewPartCategoryPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.from("part_categories").insert({
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
    });

    if (error) {
      alert("保存失败: " + error.message);
      setLoading(false);
      return;
    }

    router.push("/part-categories");
    router.refresh();
  }

  function CommissionField({ label, typeValue, valueValue, onTypeChange, onValueChange }: {
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
          <select className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm" value={typeValue} onChange={(e) => onTypeChange(e.target.value)}>
            <option value="">无提成</option>
            <option value="revenue_pct">按产值(%)</option>
            <option value="profit_pct">按毛利(%)</option>
            <option value="fixed">固定金额</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">{label}数值</label>
          <input type="number" className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm" value={valueValue} onChange={(e) => onValueChange(e.target.value)} disabled={!typeValue} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="新建配件分类" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">分类名称 *</label>
            <input required className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="如：机油、滤芯、刹车片" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>

          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.auto_link_vehicle_model} onChange={(e) => setForm({ ...form, auto_link_vehicle_model: e.target.checked })} className="w-4 h-4" />
              <span className="text-sm text-gray-700">自动关联车型</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_consumable} onChange={(e) => setForm({ ...form, is_consumable: e.target.checked })} className="w-4 h-4" />
              <span className="text-sm text-gray-700">耗材（出库不计入营业额）</span>
            </label>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <h2 className="text-base font-semibold text-gray-900 mb-4">提成标准配置</h2>
            <div className="space-y-4">
              <CommissionField label="销售提成" typeValue={form.sales_type} valueValue={form.sales_value} onTypeChange={(v) => setForm({ ...form, sales_type: v as any })} onValueChange={(v) => setForm({ ...form, sales_value: v })} />
              <CommissionField label="诊断提成" typeValue={form.diagnosis_type} valueValue={form.diagnosis_value} onTypeChange={(v) => setForm({ ...form, diagnosis_type: v as any })} onValueChange={(v) => setForm({ ...form, diagnosis_value: v })} />
              <CommissionField label="施工提成" typeValue={form.repair_type} valueValue={form.repair_value} onTypeChange={(v) => setForm({ ...form, repair_type: v as any })} onValueChange={(v) => setForm({ ...form, repair_value: v })} />
              <CommissionField label="质检提成" typeValue={form.qc_type} valueValue={form.qc_value} onTypeChange={(v) => setForm({ ...form, qc_type: v as any })} onValueChange={(v) => setForm({ ...form, qc_value: v })} />
              <CommissionField label="领料提成" typeValue={form.picking_type} valueValue={form.picking_value} onTypeChange={(v) => setForm({ ...form, picking_type: v as any })} onValueChange={(v) => setForm({ ...form, picking_value: v })} />
            </div>
          </div>
        </div>

        <div className="mt-8 flex gap-3 justify-end">
          <button type="button" onClick={() => router.back()} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
          <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">保存</button>
        </div>
      </form>
    </div>
  );
}
