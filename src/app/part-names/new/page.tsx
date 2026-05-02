"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

interface LinkedItem {
  id: string;
  name: string;
}

export default function NewPartNamePage() {
  const router = useRouter();
  const supabase = createClient();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);

  const [categories, setCategories] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: "",
    category_id: "",
    unit: "件",
    search_keywords: "",
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

  const [linkedBrands, setLinkedBrands] = useState<LinkedItem[]>([]);
  const [linkedSpecs, setLinkedSpecs] = useState<LinkedItem[]>([]);

  const [brandQuery, setBrandQuery] = useState("");
  const [brandResults, setBrandResults] = useState<any[] | null>(null);
  const [brandSearching, setBrandSearching] = useState(false);

  const [specQuery, setSpecQuery] = useState("");
  const [specResults, setSpecResults] = useState<any[] | null>(null);
  const [specSearching, setSpecSearching] = useState(false);

  useEffect(() => {
    supabase
      .from("part_categories")
      .select(
        "id, name, auto_link_vehicle_model, is_consumable, sales_commission_type, sales_commission_value, diagnosis_commission_type, diagnosis_commission_value, repair_commission_type, repair_commission_value, qc_commission_type, qc_commission_value, picking_commission_type, picking_commission_value"
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
        .from("part_names")
        .select("id, name, part_categories(name)")
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

  function handleCategoryChange(categoryId: string) {
    const cat = categories.find((c) => c.id === categoryId);
    if (cat) {
      setForm((prev) => ({
        ...prev,
        category_id: categoryId,
        auto_link_vehicle_model: cat.auto_link_vehicle_model || false,
        is_consumable: cat.is_consumable || false,
        sales_type: cat.sales_commission_type || "",
        sales_value: cat.sales_commission_value?.toString() || "",
        diagnosis_type: cat.diagnosis_commission_type || "",
        diagnosis_value: cat.diagnosis_commission_value?.toString() || "",
        repair_type: cat.repair_commission_type || "",
        repair_value: cat.repair_commission_value?.toString() || "",
        qc_type: cat.qc_commission_type || "",
        qc_value: cat.qc_commission_value?.toString() || "",
        picking_type: cat.picking_commission_type || "",
        picking_value: cat.picking_commission_value?.toString() || "",
      }));
    } else {
      setForm((prev) => ({ ...prev, category_id: categoryId }));
    }
  }

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!brandQuery.trim()) { setBrandResults(null); return; }
      setBrandSearching(true);
      const { data } = await supabase.from("part_brands").select("id, name").ilike("name", `%${brandQuery.trim()}%`).order("name").limit(10);
      setBrandResults(data || []);
      setBrandSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [brandQuery, supabase]);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!specQuery.trim()) { setSpecResults(null); return; }
      setSpecSearching(true);
      const { data } = await supabase.from("part_specifications").select("id, name").ilike("name", `%${specQuery.trim()}%`).order("name").limit(10);
      setSpecResults(data || []);
      setSpecSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [specQuery, supabase]);

  async function createBrandAndLink() {
    if (!brandQuery.trim()) return;
    const { data, error } = await supabase.from("part_brands").insert({ name: brandQuery.trim() }).select("id, name").single();
    if (error || !data) { alert("创建品牌失败: " + (error?.message || "未知错误")); return; }
    addBrand({ id: data.id, name: data.name });
    setBrandQuery("");
  }

  async function createSpecAndLink() {
    if (!specQuery.trim()) return;
    const { data, error } = await supabase.from("part_specifications").insert({ name: specQuery.trim() }).select("id, name").single();
    if (error || !data) { alert("创建规格失败: " + (error?.message || "未知错误")); return; }
    addSpec({ id: data.id, name: data.name });
    setSpecQuery("");
  }

  function addBrand(b: LinkedItem) {
    if (linkedBrands.some((x) => x.id === b.id)) return;
    setLinkedBrands((prev) => [...prev, b]);
    setBrandQuery("");
    setBrandResults([]);
  }

  function removeBrand(id: string) {
    setLinkedBrands((prev) => prev.filter((x) => x.id !== id));
  }

  function addSpec(s: LinkedItem) {
    if (linkedSpecs.some((x) => x.id === s.id)) return;
    setLinkedSpecs((prev) => [...prev, s]);
    setSpecQuery("");
    setSpecResults([]);
  }

  function removeSpec(id: string) {
    setLinkedSpecs((prev) => prev.filter((x) => x.id !== id));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.category_id) {
      alert("请填写配件名称和所属分类");
      return;
    }
    setLoading(true);

    const { data: inserted, error } = await supabase.from("part_names").insert({
      name: form.name.trim(),
      category_id: form.category_id,
      unit: form.unit,
      search_keywords: form.search_keywords || null,
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
    }).select("id").single();

    if (error || !inserted) {
      alert("保存失败: " + (error?.message || "未知错误"));
      setLoading(false);
      return;
    }

    const newId = inserted.id;

    if (linkedBrands.length > 0) {
      await supabase.from("part_name_brands").insert(linkedBrands.map((b) => ({ part_name_id: newId, brand_id: b.id })));
    }
    if (linkedSpecs.length > 0) {
      await supabase.from("part_name_specifications").insert(linkedSpecs.map((s) => ({ part_name_id: newId, specification_id: s.id })));
    }

    router.push("/part-names");
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

  function SearchLinkSection({
    label, query, setQuery, results, searching, linked, onAdd, onRemove, onCreate,
  }: any) {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    useEffect(() => {
      setSelectedIds(new Set());
    }, [results]);

    const alreadyLinkedIds = new Set(linked.map((x: any) => x.id));

    function toggleResult(id: string) {
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelectedIds(next);
    }

    function handleAddSelected() {
      if (!results) return;
      for (const r of results) {
        if (selectedIds.has(r.id) && !alreadyLinkedIds.has(r.id)) {
          onAdd(r);
        }
      }
      setSelectedIds(new Set());
      setQuery("");
    }

    return (
      <div className="mt-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">{label}（可选，可关联多个）</label>
        <div className="relative">
          <input
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={`搜索${label}并添加...`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {searching && <div className="text-xs text-gray-400 mt-1">搜索中...</div>}
          {results && results.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {results.map((r: any) => {
                const isLinked = alreadyLinkedIds.has(r.id);
                const isSelected = selectedIds.has(r.id);
                return (
                  <label
                    key={r.id}
                    className={`flex items-center gap-2 px-4 py-2 border-b border-gray-100 last:border-0 cursor-pointer hover:bg-gray-50 ${isLinked ? 'opacity-40' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={isLinked}
                      onChange={() => toggleResult(r.id)}
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-gray-900">{r.name}</span>
                  </label>
                );
              })}
              {selectedIds.size > 0 && (
                <div className="sticky bottom-0 bg-white border-t border-gray-100 px-4 py-2">
                  <button
                    type="button"
                    onClick={handleAddSelected}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
                  >
                    添加选中 ({selectedIds.size})
                  </button>
                </div>
              )}
            </div>
          )}
          {!searching && query.trim() && results !== null && results.length === 0 && (
            <div className="mt-2">
              <button type="button" onClick={onCreate} className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700">
                新建「{query.trim()}」并关联
              </button>
            </div>
          )}
        </div>
        {linked.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {linked.map((item: any) => (
              <span key={item.id} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-md border border-blue-200">
                {item.name}
                <button type="button" onClick={() => onRemove(item.id)} className="text-blue-400 hover:text-blue-600">×</button>
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="新建配件名称" />
      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
        {!showForm && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">搜索配件名称</label>
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
                    <div className="text-sm text-red-600 font-medium">该配件名称已存在，不允许新建相同名称</div>
                    <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                      {results.map((r) => (
                        <div
                          key={r.id}
                          className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
                        >
                          <span className="text-sm text-gray-900">{r.name}</span>
                          <span className="text-xs text-gray-400">{r.part_categories?.name || "-"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-sm text-gray-500">未找到包含「{query.trim()}」的配件名称。</div>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">配件名称 *</label>
              <input
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="如：机油、空气滤芯"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">所属分类 *</label>
              <select
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.category_id}
                onChange={(e) => handleCategoryChange(e.target.value)}
              >
                <option value="">请选择</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">单位</label>
              <input
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="如：件、升、个"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">搜索关键词</label>
              <input
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="如：机油 润滑油 发动机油"
                value={form.search_keywords}
                onChange={(e) => setForm({ ...form, search_keywords: e.target.value })}
              />
              <p className="text-xs text-gray-400 mt-1">用于模糊搜索，多个词用空格分隔</p>
            </div>

            <SearchLinkSection
              label="关联品牌"
              query={brandQuery}
              setQuery={setBrandQuery}
              results={brandResults}
              searching={brandSearching}
              linked={linkedBrands}
              onAdd={addBrand}
              onRemove={removeBrand}
              onCreate={createBrandAndLink}
            />

            <SearchLinkSection
              label="关联规格"
              query={specQuery}
              setQuery={setSpecQuery}
              results={specResults}
              searching={specSearching}
              linked={linkedSpecs}
              onAdd={addSpec}
              onRemove={removeSpec}
              onCreate={createSpecAndLink}
            />

            <div className="border-t border-gray-100 pt-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">分类属性（选择分类后自动带入，可修改）</h3>
              <div className="flex gap-6 mb-4">
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
