"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";

export default function NewPartCategoryPage() {
  const router = useRouter();
  const supabase = createClient();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [showForm, setShowForm] = useState(false);
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

  const search = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      setSearching(true);
      const { data } = await supabase
        .from("part_categories")
        .select("id, name")
        .ilike("name", `%${q.trim()}%`)
        .order("name")
        .limit(20);
      setResults(data || []);
      setSearching(false);
    },
    [supabase]
  );

  async function handleSearch() {
    await search(query);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearch();
    }
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
    setLoading(true);

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
      setLoading(false);
      return;
    }

    router.push("/part-categories");
    router.refresh();
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
      <PageHeader title="新建配件分类" />

      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
        {!showForm && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                搜索分类名称
              </label>
              <div className="flex gap-2">
                <input
                  autoFocus
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="输入名称逐字检索，如：机油"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <button
                  type="button"
                  onClick={handleSearch}
                  disabled={searching || !query.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {searching ? "搜索中..." : "搜索"}
                </button>
              </div>
            </div>

            {searching && (
              <div className="text-sm text-gray-500 py-2">搜索中...</div>
            )}

            {!searching && query.trim() && (
              <div>
                {results.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-sm text-red-600 font-medium">
                      该分类已存在，不允许新建相同分类
                    </div>
                    <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                      {results.map((r) => (
                        <div
                          key={r.id}
                          className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
                        >
                          <span className="text-sm text-gray-900">{r.name}</span>
                          <Link
                            href={`/part-categories/${r.id}/edit`}
                            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                          >
                            查看/编辑
                          </Link>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-sm text-gray-500">
                      未找到包含「{query.trim()}」的分类。
                    </div>
                    <button
                      type="button"
                      onClick={handleStartCreate}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                    >
                      新建分类「{query.trim()}」
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {showForm && (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                分类名称 *
              </label>
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
                  onChange={(e) =>
                    setForm({ ...form, auto_link_vehicle_model: e.target.checked })
                  }
                  className="w-4 h-4"
                />
                <span className="text-sm text-gray-700">自动关联车型</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_consumable}
                  onChange={(e) =>
                    setForm({ ...form, is_consumable: e.target.checked })
                  }
                  className="w-4 h-4"
                />
                <span className="text-sm text-gray-700">耗材（出库不计入营业额）</span>
              </label>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <h2 className="text-base font-semibold text-gray-900 mb-4">
                提成标准配置
              </h2>
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

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setQuery("");
                  setResults([]);
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                返回搜索
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? "保存中..." : "保存"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
