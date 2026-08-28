"use client";

import {useState, useEffect, useMemo} from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { SearchLinkSection } from "../../SearchLinkSection";
import { 更新配件名称 } from "../../actions";
import { 新建配件品牌, 新建配件规格 } from "@/app/inventory/actions";

interface LinkedItem {
  id: string;
  name: string;
}

interface CommissionFieldProps {
  label: string;
  typeValue: string;
  valueValue: string;
  onTypeChange: (value: string) => void;
  onValueChange: (value: string) => void;
}

function CommissionField({ label, typeValue, valueValue, onTypeChange, onValueChange }: CommissionFieldProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div><label className="block text-xs text-gray-500 mb-1">{label}方式</label><select className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm" value={typeValue} onChange={(e) => onTypeChange(e.target.value)}><option value="">无提成</option><option value="revenue_pct">按产值(%)</option><option value="profit_pct">按毛利(%)</option><option value="fixed">固定金额</option></select></div>
      <div><label className="block text-xs text-gray-500 mb-1">{label}数值</label><input type="number" className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm" value={valueValue} onChange={(e) => onValueChange(e.target.value)} disabled={!typeValue} /></div>
    </div>
  );
}

export default function EditPartNamePage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  interface Category {
    id: string;
    name: string;
    auto_link_vehicle_model?: boolean;
    auto_match_17vin_models?: boolean;
    is_consumable?: boolean;
    require_scan_check?: boolean;
    require_location_check?: boolean;
    sales_commission_type?: string | null;
    sales_commission_value?: number | null;
    diagnosis_commission_type?: string | null;
    diagnosis_commission_value?: number | null;
    repair_commission_type?: string | null;
    repair_commission_value?: number | null;
    qc_commission_type?: string | null;
    qc_commission_value?: number | null;
    picking_commission_type?: string | null;
    picking_commission_value?: number | null;
  }
  const [categories, setCategories] = useState<Category[]>([]);

  const [form, setForm] = useState({
    name: "",
    category_id: "",
    unit: "件",
    search_keywords: "",
    default_quantity: "",
    auto_link_vehicle_model: false,
    auto_match_17vin_models: false,
    is_consumable: false,
    require_scan_check: false,
    require_location_check: false,
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
  interface BrandResult {
    id: string;
    name: string;
  }
  const [brandResults, setBrandResults] = useState<BrandResult[] | null>(null);
  const [brandSearching, setBrandSearching] = useState(false);

  const [specQuery, setSpecQuery] = useState("");
  interface SpecResult {
    id: string;
    name: string;
  }
  const [specResults, setSpecResults] = useState<SpecResult[] | null>(null);
  const [specSearching, setSpecSearching] = useState(false);

  useEffect(() => {
    async function load() {
      const [{ data: part }, { data: cats }, { data: brandLinks }, { data: specLinks }] = await Promise.all([
        supabase.from("part_names").select("*").eq("id", id).single(),
        supabase
          .from("part_categories")
          .select("id, name, auto_link_vehicle_model, auto_match_17vin_models, is_consumable, require_scan_check, require_location_check, sales_commission_type, sales_commission_value, diagnosis_commission_type, diagnosis_commission_value, repair_commission_type, repair_commission_value, qc_commission_type, qc_commission_value, picking_commission_type, picking_commission_value")
          .order("name"),
        supabase.from("part_name_brands").select("brand_id, part_brands(id, name)").eq("part_name_id", id),
        supabase.from("part_name_specifications").select("specification_id, part_specifications(id, name)").eq("part_name_id", id),
      ]);

      if (!part) { alert("配件名称不存在"); router.push("/part-names"); return; }

      setCategories(cats || []);
      setForm({
        name: part.name || "",
        category_id: part.category_id || "",
        unit: part.unit || "件",
        search_keywords: part.search_keywords || "",
        default_quantity: part.default_quantity?.toString() || "",
        auto_link_vehicle_model: part.auto_link_vehicle_model || false,
        auto_match_17vin_models: part.auto_match_17vin_models || false,
        is_consumable: part.is_consumable || false,
        require_scan_check: part.require_scan_check || false,
        require_location_check: part.require_location_check || false,
        sales_type: part.sales_commission_type || "",
        sales_value: part.sales_commission_value?.toString() || "",
        diagnosis_type: part.diagnosis_commission_type || "",
        diagnosis_value: part.diagnosis_commission_value?.toString() || "",
        repair_type: part.repair_commission_type || "",
        repair_value: part.repair_commission_value?.toString() || "",
        qc_type: part.qc_commission_type || "",
        qc_value: part.qc_commission_value?.toString() || "",
        picking_type: part.picking_commission_type || "",
        picking_value: part.picking_commission_value?.toString() || "",
      });
      interface BrandLink {
        brand_id: string;
        part_brands?: { name?: string } | null;
      }
      interface SpecLink {
        specification_id: string;
        part_specifications?: { name?: string } | null;
      }
      setLinkedBrands(((brandLinks || []) as unknown as BrandLink[]).map((l) => ({ id: l.brand_id, name: l.part_brands?.name ?? "" })).filter((x) => x.name));
      setLinkedSpecs(((specLinks || []) as unknown as SpecLink[]).map((l) => ({ id: l.specification_id, name: l.part_specifications?.name ?? "" })).filter((x) => x.name));
      setLoading(false);
    }
    load();
  }, [id, supabase, router]);

  useEffect(() => {
    setBrandResults(null);
    const t = setTimeout(async () => {
      if (!brandQuery.trim()) return;
      setBrandSearching(true);
      const { data } = await supabase.from("part_brands").select("id, name").ilike("name", `%${brandQuery.trim()}%`).order("name").limit(10);
      setBrandResults(data || []);
      setBrandSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [brandQuery, supabase]);

  useEffect(() => {
    setSpecResults(null);
    const t = setTimeout(async () => {
      if (!specQuery.trim()) return;
      setSpecSearching(true);
      const { data } = await supabase.from("part_specifications").select("id, name").ilike("name", `%${specQuery.trim()}%`).order("name").limit(10);
      setSpecResults(data || []);
      setSpecSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [specQuery, supabase]);

  function handleCategoryChange(categoryId: string) {
    const cat = categories.find((c) => c.id === categoryId);
    if (cat) {
      setForm((prev) => ({
        ...prev, category_id: categoryId,
        auto_link_vehicle_model: cat.auto_link_vehicle_model || false,
        auto_match_17vin_models: cat.auto_match_17vin_models || false,
        is_consumable: cat.is_consumable || false,
        require_scan_check: cat.require_scan_check || false,
        require_location_check: cat.require_location_check || false,
        sales_type: (cat.sales_commission_type || "") as "" | "revenue_pct" | "profit_pct" | "fixed", sales_value: cat.sales_commission_value?.toString() || "",
        diagnosis_type: (cat.diagnosis_commission_type || "") as "" | "revenue_pct" | "profit_pct" | "fixed", diagnosis_value: cat.diagnosis_commission_value?.toString() || "",
        repair_type: (cat.repair_commission_type || "") as "" | "revenue_pct" | "profit_pct" | "fixed", repair_value: cat.repair_commission_value?.toString() || "",
        qc_type: (cat.qc_commission_type || "") as "" | "revenue_pct" | "profit_pct" | "fixed", qc_value: cat.qc_commission_value?.toString() || "",
        picking_type: (cat.picking_commission_type || "") as "" | "revenue_pct" | "profit_pct" | "fixed", picking_value: cat.picking_commission_value?.toString() || "",
      }));
    } else {
      setForm((prev) => ({ ...prev, category_id: categoryId }));
    }
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
    setBrandResults(null);
  }

  function removeBrand(id: string) {
    setLinkedBrands((prev) => prev.filter((x) => x.id !== id));
  }

  function addSpec(s: LinkedItem) {
    if (linkedSpecs.some((x) => x.id === s.id)) return;
    setLinkedSpecs((prev) => [...prev, s]);
    setSpecQuery("");
    setSpecResults(null);
  }

  function removeSpec(id: string) {
    setLinkedSpecs((prev) => prev.filter((x) => x.id !== id));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.category_id) { alert("请填写配件名称和所属分类"); return; }
    setSaving(true);

    /* 写库走 Server Action（重名检查 + 更新 + 品牌/规格关联差量同步，服务端一次完成） */
    const result = await 更新配件名称({
      id,
      form,
      linkedBrandIds: linkedBrands.map((b) => b.id),
      linkedSpecIds: linkedSpecs.map((s) => s.id),
    });
    if (!result.success) { alert("保存失败: " + (result.error || "未知错误")); setSaving(false); return; }

    router.push("/part-names");
    router.refresh();
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="编辑配件名称" />
        <div className="text-sm text-gray-500 py-8">加载中...</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="编辑配件名称" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">配件名称 *</label>
          <input required className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">所属分类 *</label>
          <select required className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.category_id} onChange={(e) => handleCategoryChange(e.target.value)}>
            <option value="">请选择</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">单位</label>
          <input className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">搜索关键词</label>
          <input className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.search_keywords} onChange={(e) => setForm({ ...form, search_keywords: e.target.value })} />
          <p className="text-xs text-gray-400 mt-1">用于模糊搜索，多个词用空格分隔</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">默认数量</label>
          <input type="number" min={1} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="关联到维修项目时的默认使用数量，留空则为1" value={form.default_quantity} onChange={(e) => setForm({ ...form, default_quantity: e.target.value })} />
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
          <div className="flex gap-6 flex-wrap mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.auto_link_vehicle_model} onChange={(e) => setForm({ ...form, auto_link_vehicle_model: e.target.checked })} className="w-4 h-4" />
              <span className="text-sm text-gray-700">自动关联车型</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer" title="勾选后，该配件使用时会自动匹配17VIN中的全部适配车型">
              <input type="checkbox" checked={form.auto_match_17vin_models} onChange={(e) => setForm({ ...form, auto_match_17vin_models: e.target.checked })} className="w-4 h-4" />
              <span className="text-sm text-gray-700">17VIN自动匹配全部车型</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_consumable} onChange={(e) => setForm({ ...form, is_consumable: e.target.checked })} className="w-4 h-4" />
              <span className="text-sm text-gray-700">耗材（出库不计入营业额）</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer" title="勾选后，该配件出库时需要库管扫码确认">
              <input type="checkbox" checked={form.require_scan_check} onChange={(e) => setForm({ ...form, require_scan_check: e.target.checked })} className="w-4 h-4" />
              <span className="text-sm text-gray-700">扫码出库确认</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer" title="勾选后，该配件入库时必须填写/确认存放位置">
              <input type="checkbox" checked={form.require_location_check} onChange={(e) => setForm({ ...form, require_location_check: e.target.checked })} className="w-4 h-4" />
              <span className="text-sm text-gray-700">入库仓位确认</span>
            </label>
          </div>
          <div className="space-y-4">
            <CommissionField label="销售提成" typeValue={form.sales_type} valueValue={form.sales_value} onTypeChange={(v: string) => setForm({ ...form, sales_type: v as "" | "revenue_pct" | "profit_pct" | "fixed", sales_value: v ? form.sales_value : "" })} onValueChange={(v: string) => setForm({ ...form, sales_value: v })} />
            <CommissionField label="诊断提成" typeValue={form.diagnosis_type} valueValue={form.diagnosis_value} onTypeChange={(v: string) => setForm({ ...form, diagnosis_type: v as "" | "revenue_pct" | "profit_pct" | "fixed", diagnosis_value: v ? form.diagnosis_value : "" })} onValueChange={(v: string) => setForm({ ...form, diagnosis_value: v })} />
            <CommissionField label="施工提成" typeValue={form.repair_type} valueValue={form.repair_value} onTypeChange={(v: string) => setForm({ ...form, repair_type: v as "" | "revenue_pct" | "profit_pct" | "fixed", repair_value: v ? form.repair_value : "" })} onValueChange={(v: string) => setForm({ ...form, repair_value: v })} />
            <CommissionField label="质检提成" typeValue={form.qc_type} valueValue={form.qc_value} onTypeChange={(v: string) => setForm({ ...form, qc_type: v as "" | "revenue_pct" | "profit_pct" | "fixed", qc_value: v ? form.qc_value : "" })} onValueChange={(v: string) => setForm({ ...form, qc_value: v })} />
            <CommissionField label="领料提成" typeValue={form.picking_type} valueValue={form.picking_value} onTypeChange={(v: string) => setForm({ ...form, picking_type: v as "" | "revenue_pct" | "profit_pct" | "fixed", picking_value: v ? form.picking_value : "" })} onValueChange={(v: string) => setForm({ ...form, picking_value: v })} />
          </div>
        </div>

        <div className="flex gap-3 justify-end pt-4">
          <button type="button" onClick={() => router.push("/part-names")} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">{saving ? "保存中..." : "保存"}</button>
        </div>
      </form>
    </div>
  );
}
