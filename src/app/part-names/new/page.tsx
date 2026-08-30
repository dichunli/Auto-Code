"use client";

import {useState, useCallback, useEffect, useMemo} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { SearchLinkSection } from "../SearchLinkSection";
import { 新建配件名称 } from "../actions";
import { 新建配件品牌, 新建配件规格 } from "@/app/inventory/actions";
import { 清理搜索词 } from "@/lib/sanitizeQuery";

interface LinkedItem {
  id: string;
  name: string;
}

interface PartCategory {
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
}

interface SearchResult {
  id: string;
  name: string;
  part_categories: { name: string } | null;
}

interface BrandResult {
  id: string;
  name: string;
}

interface SpecResult {
  id: string;
  name: string;
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

export default function NewPartNamePage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);

  const [categories, setCategories] = useState<PartCategory[]>([]);
  const [form, setForm] = useState({
    name: "",
    category_id: "",
    unit: "件",
    search_keywords: "",
    default_quantity: "",
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
  const [specQuery, setSpecQuery] = useState("");

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
        .or(`name.ilike.%${清理搜索词(q)}%,search_keywords.ilike.%${清理搜索词(q)}%`)
        .order("name")
        .limit(20);
      setResults((data || []) as unknown as SearchResult[]);
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
        sales_type: (cat.sales_commission_type || "") as "" | "revenue_pct" | "profit_pct" | "fixed",
        sales_value: cat.sales_commission_value?.toString() || "",
        diagnosis_type: (cat.diagnosis_commission_type || "") as "" | "revenue_pct" | "profit_pct" | "fixed",
        diagnosis_value: cat.diagnosis_commission_value?.toString() || "",
        repair_type: (cat.repair_commission_type || "") as "" | "revenue_pct" | "profit_pct" | "fixed",
        repair_value: cat.repair_commission_value?.toString() || "",
        qc_type: (cat.qc_commission_type || "") as "" | "revenue_pct" | "profit_pct" | "fixed",
        qc_value: cat.qc_commission_value?.toString() || "",
        picking_type: (cat.picking_commission_type || "") as "" | "revenue_pct" | "profit_pct" | "fixed",
        picking_value: cat.picking_commission_value?.toString() || "",
      }));
    } else {
      setForm((prev) => ({ ...prev, category_id: categoryId }));
    }
  }

  /* 品牌/规格联想查询（查询条件与原防抖块一致，仅换成 SearchDropdown 的 searchFn） */
  async function 搜索品牌(q: string): Promise<BrandResult[]> {
    const { data } = await supabase.from("part_brands").select("id, name").ilike("name", `%${q}%`).order("name").limit(10);
    return data || [];
  }

  async function 搜索规格(q: string): Promise<SpecResult[]> {
    const { data } = await supabase.from("part_specifications").select("id, name").ilike("name", `%${q}%`).order("name").limit(10);
    return data || [];
  }

  async function createBrandAndLink() {
    if (!brandQuery.trim()) return;
    /* 写库走 Server Action */
    const result = await 新建配件品牌(brandQuery.trim());
    if (!result.success || !result.id) { alert("创建品牌失败: " + (result.error || "未知错误")); return; }
    addBrand({ id: result.id, name: brandQuery.trim() });
    setBrandQuery("");
  }

  async function createSpecAndLink() {
    if (!specQuery.trim()) return;
    const result = await 新建配件规格(specQuery.trim());
    if (!result.success || !result.id) { alert("创建规格失败: " + (result.error || "未知错误")); return; }
    addSpec({ id: result.id, name: specQuery.trim() });
    setSpecQuery("");
  }

  function addBrand(b: LinkedItem) {
    if (linkedBrands.some((x) => x.id === b.id)) return;
    setLinkedBrands((prev) => [...prev, b]);
    setBrandQuery("");
  }

  function removeBrand(id: string) {
    setLinkedBrands((prev) => prev.filter((x) => x.id !== id));
  }

  function addSpec(s: LinkedItem) {
    if (linkedSpecs.some((x) => x.id === s.id)) return;
    setLinkedSpecs((prev) => [...prev, s]);
    setSpecQuery("");
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

    /* 写库走 Server Action（重名检查 + 建名称 + 关联品牌/规格，服务端一次完成） */
    const result = await 新建配件名称({
      form,
      linkedBrandIds: linkedBrands.map((b) => b.id),
      linkedSpecIds: linkedSpecs.map((s) => s.id),
    });

    if (!result.success) {
      alert("保存失败: " + (result.error || "未知错误"));
      setLoading(false);
      return;
    }

    router.push("/part-names");
    router.refresh();
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
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">默认数量</label>
              <input
                type="number"
                min={1}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="关联到维修项目时的默认使用数量，留空则为1"
                value={form.default_quantity}
                onChange={(e) => setForm({ ...form, default_quantity: e.target.value })}
              />
            </div>

            <SearchLinkSection
              label="关联品牌"
              query={brandQuery}
              setQuery={setBrandQuery}
              searchFn={搜索品牌}
              linked={linkedBrands}
              onAdd={addBrand}
              onRemove={removeBrand}
              onCreate={createBrandAndLink}
            />

            <SearchLinkSection
              label="关联规格"
              query={specQuery}
              setQuery={setSpecQuery}
              searchFn={搜索规格}
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
                  onTypeChange={(v) => setForm({ ...form, sales_type: v as "" | "revenue_pct" | "profit_pct" | "fixed", sales_value: v ? form.sales_value : "" })}
                  onValueChange={(v) => setForm({ ...form, sales_value: v })}
                />
                <CommissionField
                  label="诊断提成"
                  typeValue={form.diagnosis_type}
                  valueValue={form.diagnosis_value}
                  onTypeChange={(v) => setForm({ ...form, diagnosis_type: v as "" | "revenue_pct" | "profit_pct" | "fixed", diagnosis_value: v ? form.diagnosis_value : "" })}
                  onValueChange={(v) => setForm({ ...form, diagnosis_value: v })}
                />
                <CommissionField
                  label="施工提成"
                  typeValue={form.repair_type}
                  valueValue={form.repair_value}
                  onTypeChange={(v) => setForm({ ...form, repair_type: v as "" | "revenue_pct" | "profit_pct" | "fixed", repair_value: v ? form.repair_value : "" })}
                  onValueChange={(v) => setForm({ ...form, repair_value: v })}
                />
                <CommissionField
                  label="质检提成"
                  typeValue={form.qc_type}
                  valueValue={form.qc_value}
                  onTypeChange={(v) => setForm({ ...form, qc_type: v as "" | "revenue_pct" | "profit_pct" | "fixed", qc_value: v ? form.qc_value : "" })}
                  onValueChange={(v) => setForm({ ...form, qc_value: v })}
                />
                <CommissionField
                  label="领料提成"
                  typeValue={form.picking_type}
                  valueValue={form.picking_value}
                  onTypeChange={(v) => setForm({ ...form, picking_type: v as "" | "revenue_pct" | "profit_pct" | "fixed", picking_value: v ? form.picking_value : "" })}
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
