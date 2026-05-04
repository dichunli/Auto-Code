"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

interface LinkedItem {
  id: string;
  name: string;
  quantity: number | null;
}

export default function NewServiceNamePage() {
  const router = useRouter();
  const supabase = createClient();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);

  const [form, setForm] = useState({
    category_id: "",
    name: "",
    search_keywords: "",
    sales_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    sales_value: "",
    diagnosis_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    diagnosis_value: "",
    repair_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    repair_value: "",
    qc_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    qc_value: "",
  });

  const [linkedParts, setLinkedParts] = useState<LinkedItem[]>([]);
  const [partQuery, setPartQuery] = useState("");
  const [partResults, setPartResults] = useState<any[] | null>(null);
  const [partSearching, setPartSearching] = useState(false);

  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    supabase
      .from("service_categories")
      .select(
        "id, name, sales_commission_type, sales_commission_value, diagnosis_commission_type, diagnosis_commission_value, repair_commission_type, repair_commission_value, qc_commission_type, qc_commission_value"
      )
      .order("name")
      .then(({ data }) => setCategories(data || []));
  }, [supabase]);

  const search = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      setSearching(true);
      const { data } = await supabase
        .from("service_names")
        .select("id, name, service_categories(name)")
        .or(`name.ilike.%${q.trim()}%,search_keywords.ilike.%${q.trim()}%`)
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

  function handleCategoryChange(categoryId: string) {
    const cat = categories.find((c) => c.id === categoryId);
    if (cat) {
      setForm((prev) => ({
        ...prev,
        category_id: categoryId,
        sales_type: cat.sales_commission_type || "",
        sales_value: cat.sales_commission_value?.toString() || "",
        diagnosis_type: cat.diagnosis_commission_type || "",
        diagnosis_value: cat.diagnosis_commission_value?.toString() || "",
        repair_type: cat.repair_commission_type || "",
        repair_value: cat.repair_commission_value?.toString() || "",
        qc_type: cat.qc_commission_type || "",
        qc_value: cat.qc_commission_value?.toString() || "",
      }));
    } else {
      setForm((prev) => ({ ...prev, category_id: categoryId }));
    }
  }

  async function handleSearchPart() {
    const q = partQuery.trim();
    if (!q) {
      setPartResults(null);
      return;
    }
    setPartSearching(true);
    const { data } = await supabase
      .from("part_names")
      .select("id, name, default_quantity")
      .or(`name.ilike.%${q}%,search_keywords.ilike.%${q}%`)
      .order("name")
      .limit(20);
    setPartResults(data || []);
    setPartSearching(false);
  }

  function handlePartKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearchPart();
    }
  }

  function addPart(p: { id: string; name: string; default_quantity?: number | null }) {
    if (linkedParts.some((x) => x.id === p.id)) {
      alert("该配件已关联");
      return;
    }
    setLinkedParts((prev) => [...prev, { id: p.id, name: p.name, quantity: p.default_quantity ?? null }]);
  }

  function removePart(id: string) {
    setLinkedParts((prev) => prev.filter((x) => x.id !== id));
  }

  function handleDragStart(index: number) {
    setDragIndex(index);
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    setLinkedParts((prev) => {
      const newParts = [...prev];
      const [removed] = newParts.splice(dragIndex, 1);
      newParts.splice(index, 0, removed);
      return newParts;
    });
    setDragIndex(index);
  }

  function handleDragEnd() {
    setDragIndex(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.category_id) {
      alert("请填写项目名称和所属分类");
      return;
    }
    setLoading(true);

    const { data: dup } = await supabase
      .from("service_names")
      .select("id")
      .ilike("name", form.name.trim())
      .maybeSingle();
    if (dup) {
      alert("该项目名称已存在，请更换");
      setLoading(false);
      return;
    }

    const { data: inserted, error } = await supabase
      .from("service_names")
      .insert({
        category_id: form.category_id,
        name: form.name.trim(),
        search_keywords: form.search_keywords || null,
        sales_commission_type: form.sales_type || null,
        sales_commission_value: form.sales_value ? parseFloat(form.sales_value) : null,
        diagnosis_commission_type: form.diagnosis_type || null,
        diagnosis_commission_value: form.diagnosis_value ? parseFloat(form.diagnosis_value) : null,
        repair_commission_type: form.repair_type || null,
        repair_commission_value: form.repair_value ? parseFloat(form.repair_value) : null,
        qc_commission_type: form.qc_type || null,
        qc_commission_value: form.qc_value ? parseFloat(form.qc_value) : null,
      })
      .select("id")
      .single();

    if (error || !inserted) {
      alert("保存失败: " + (error?.message || "未知错误"));
      setLoading(false);
      return;
    }

    if (linkedParts.length > 0) {
      const { error: linkError } = await supabase
        .from("service_name_part_names")
        .insert(
          linkedParts.map((p, idx) => ({ service_name_id: inserted.id, part_name_id: p.id, sort_order: idx, quantity: p.quantity }))
        );
      if (linkError) {
        alert("保存配件关联失败: " + linkError.message);
        setLoading(false);
        return;
      }
    }

    router.push("/service-names");
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
      <PageHeader title="新建维修项目名称" />
      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
        {!showForm && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">搜索项目名称</label>
              <div className="flex gap-2">
                <input
                  autoFocus
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="输入名称逐字检索"
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

            {!searching && query.trim() && (
              <div>
                {results.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-sm text-red-600 font-medium">
                      该项目名称已存在，不允许新建相同名称
                    </div>
                    <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                      {results.map((r) => (
                        <div
                          key={r.id}
                          className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
                        >
                          <span className="text-sm text-gray-900">{r.name}</span>
                          <span className="text-xs text-gray-400">{r.service_categories?.name || "-"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-sm text-gray-500">
                      未找到包含「{query.trim()}」的项目名称。
                    </div>
                    <button
                      type="button"
                      onClick={handleStartCreate}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                    >
                      新建名称「{query.trim()}」
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {showForm && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">项目名称 *</label>
              <input
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="如：更换机油"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">搜索关键词</label>
              <input
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="如：机油 保养 小保养"
                value={form.search_keywords}
                onChange={(e) => setForm({ ...form, search_keywords: e.target.value })}
              />
              <p className="text-xs text-gray-400 mt-1">多个关键词用空格分隔，用于开单时快速搜索</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">所属分类 *</label>
              <select
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.category_id}
                onChange={(e) => handleCategoryChange(e.target.value)}
              >
                <option value="">请选择分类</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* 关联配件名称 */}
            <div className="mt-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">关联配件名称（检索后添加，可拖拽排序）</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="输入配件名称并检索..."
                  value={partQuery}
                  onChange={(e) => setPartQuery(e.target.value)}
                  onKeyDown={handlePartKeyDown}
                />
                <button
                  type="button"
                  onClick={handleSearchPart}
                  disabled={partSearching || !partQuery.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {partSearching ? "检索中..." : "检索"}
                </button>
              </div>

              {partResults && partResults.length > 0 && (
                <div className="mt-2 border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {partResults.map((p) => {
                    const already = linkedParts.some((x) => x.id === p.id);
                    return (
                      <div
                        key={p.id}
                        className="flex items-center justify-between px-4 py-2.5"
                      >
                        <span className="text-sm text-gray-900">{p.name}</span>
                        {already ? (
                          <span className="text-xs text-gray-400">已关联</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => addPart({ id: p.id, name: p.name, default_quantity: p.default_quantity })}
                            className="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
                          >
                            添加
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {partResults !== null && partResults.length === 0 && !partSearching && (
                <div className="mt-2 text-sm text-gray-500">
                  配件名称库中未找到「{partQuery.trim()}」，请确认名称或先在配件库中创建。
                </div>
              )}

              {linkedParts.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs text-gray-500 mb-2">已关联配件（{linkedParts.length} 条，拖拽可排序）</p>
                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                    {linkedParts.map((p, idx) => (
                      <div
                        key={p.id}
                        draggable
                        onDragStart={() => handleDragStart(idx)}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        onDragEnd={handleDragEnd}
                        className={`flex items-center justify-between px-4 py-2.5 cursor-move select-none ${dragIndex === idx ? "opacity-50 bg-blue-50" : ""}`}
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" /></svg>
                          <span className="text-sm text-gray-900 truncate">{idx + 1}. {p.name}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs text-gray-500">
                            数量：{p.quantity ?? <span className="text-gray-400">待定</span>}
                          </span>
                          <button
                            type="button"
                            onClick={() => removePart(p.id)}
                            className="text-xs text-red-600 hover:text-red-700"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-gray-100 pt-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">提成规则（选择分类后自动带入，可修改）</h3>
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
              </div>
            </div>

            <div className="flex gap-3 justify-end pt-4">
              <button
                type="button"
                onClick={() => setShowForm(false)}
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
