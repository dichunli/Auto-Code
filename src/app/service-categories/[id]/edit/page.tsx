"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export default function EditServiceCategoryPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

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

  useEffect(() => {
    supabase
      .from("service_categories")
      .select("*")
      .eq("id", id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          alert("加载失败: " + (error?.message || "分类不存在"));
          router.push("/service-categories");
          return;
        }
        setForm({
          name: data.name || "",
          sales_type: data.sales_commission_type || "",
          sales_value: data.sales_commission_value?.toString() || "",
          diagnosis_type: data.diagnosis_commission_type || "",
          diagnosis_value: data.diagnosis_commission_value?.toString() || "",
          repair_type: data.repair_commission_type || "",
          repair_value: data.repair_commission_value?.toString() || "",
          qc_type: data.qc_commission_type || "",
          qc_value: data.qc_commission_value?.toString() || "",
          dispatch_type: data.dispatch_commission_type || "",
          dispatch_value: data.dispatch_commission_value?.toString() || "",
          claim_type: data.claim_commission_type || "",
          claim_value: data.claim_commission_value?.toString() || "",
        });
        setLoading(false);
      });
  }, [id, supabase, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const { error } = await supabase
      .from("service_categories")
      .update({
        name: form.name,
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
      })
      .eq("id", id);

    if (error) {
      alert("保存失败: " + error.message);
      setSaving(false);
      return;
    }

    router.push("/service-categories");
    router.refresh();
  }

  async function handleSync() {
    if (!confirm("确定要将当前分类的提成规则同步到所有使用该分类的项目名称和项目实例吗？此操作会覆盖这些记录的现有提成设置。")) return;
    setSyncing(true);

    const updateData = {
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
    };

    const { error: nameError } = await supabase.from("service_names").update(updateData).eq("category_id", id);
    if (nameError) { alert("同步项目名称失败: " + nameError.message); setSyncing(false); return; }

    const { error: itemError } = await supabase.from("service_items").update(updateData).eq("category_id", id);
    if (itemError) { alert("同步项目实例失败: " + itemError.message); setSyncing(false); return; }

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
        <PageHeader title="编辑维修项目分类" />
        <div className="text-sm text-gray-500 py-8">加载中...</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="编辑维修项目分类" />
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
                label="派单提成"
                typeValue={form.dispatch_type}
                valueValue={form.dispatch_value}
                onTypeChange={(v) => setForm({ ...form, dispatch_type: v as any, dispatch_value: v ? form.dispatch_value : "" })}
                onValueChange={(v) => setForm({ ...form, dispatch_value: v })}
              />
              <CommissionField
                label="领单提成"
                typeValue={form.claim_type}
                valueValue={form.claim_value}
                onTypeChange={(v) => setForm({ ...form, claim_type: v as any, claim_value: v ? form.claim_value : "" })}
                onValueChange={(v) => setForm({ ...form, claim_value: v })}
              />
            </div>
          </div>
        </div>

        <div className="mt-8 flex gap-3 justify-end">
          <button
            type="button"
            onClick={() => router.push("/service-categories")}
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
            {syncing ? "同步中..." : "同步到项目"}
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
