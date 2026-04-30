"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export default function NewPartPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [partNames, setPartNames] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [specifications, setSpecifications] = useState<any[]>([]);

  const [form, setForm] = useState({
    part_number: "",
    part_name_id: "",
    brand_id: "",
    specification_id: "",
    specification_text: "",
    quantity: "0",
    min_stock: "10",
    unit_cost: "",
    unit_price: "",
    location: "",
    notes: "",
  });

  const [selectedName, setSelectedName] = useState<any>(null);

  useEffect(() => {
    supabase.from("part_names").select("*, part_categories(name)").order("name").then(({ data }) => setPartNames(data || []));
    supabase.from("part_brands").select("*").order("usage_count", { ascending: false }).then(({ data }) => setBrands(data || []));
    supabase.from("part_specifications").select("*").order("usage_count", { ascending: false }).then(({ data }) => setSpecifications(data || []));
  }, [supabase]);

  function handleNameChange(nameId: string) {
    const name = partNames.find((n) => n.id === nameId);
    setSelectedName(name || null);
    setForm((f) => ({
      ...f,
      part_name_id: nameId,
      brand_id: "",
      specification_id: "",
      specification_text: "",
    }));
  }

  async function handleCreateBrand() {
    const brandName = prompt("请输入新品牌名称:");
    if (!brandName) return;
    const { data, error } = await supabase.from("part_brands").insert({ name: brandName }).select("id").single();
    if (error) {
      alert("创建失败: " + error.message);
      return;
    }
    setBrands((prev) => [...prev, { id: data.id, name: brandName, usage_count: 0 }]);
    setForm((f) => ({ ...f, brand_id: data.id }));
  }

  async function handleCreateSpec() {
    const specName = prompt("请输入新规格名称:");
    if (!specName) return;
    const { data, error } = await supabase.from("part_specifications").insert({ name: specName }).select("id").single();
    if (error) {
      alert("创建失败: " + error.message);
      return;
    }
    setSpecifications((prev) => [...prev, { id: data.id, name: specName, usage_count: 0 }]);
    setForm((f) => ({ ...f, specification_id: data.id, specification_text: "" }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.part_name_id) {
      alert("请选择配件名称");
      return;
    }
    setLoading(true);

    const { error } = await supabase.from("parts").insert({
      part_number: form.part_number,
      part_name_id: form.part_name_id,
      brand_id: form.brand_id || null,
      specification_id: form.specification_id || null,
      specification_text: form.specification_text || null,
      quantity: parseInt(form.quantity) || 0,
      min_stock: parseInt(form.min_stock) || 10,
      unit_cost: parseFloat(form.unit_cost) || 0,
      unit_price: parseFloat(form.unit_price) || 0,
      location: form.location || null,
      notes: form.notes || null,
    });

    if (error) {
      alert("保存失败: " + error.message);
      setLoading(false);
      return;
    }

    router.push("/inventory");
    router.refresh();
  }

  return (
    <div>
      <PageHeader title="新增配件" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-3xl">
        <div className="space-y-6">
          {/* 配件名称 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">配件名称 *</label>
            <select required className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={form.part_name_id} onChange={(e) => handleNameChange(e.target.value)}>
              <option value="">请选择或搜索</option>
              {partNames.map((n) => (
                <option key={n.id} value={n.id}>{n.name} ({n.part_categories?.name})</option>
              ))}
            </select>
            {selectedName && (
              <div className="mt-2 flex gap-4 text-sm text-gray-600">
                <span>分类: {selectedName.part_categories?.name || "-"}</span>
                <span>单位: {selectedName.unit || "-"}</span>
              </div>
            )}
            <p className="text-xs text-gray-400 mt-1">如没有需要的名称，请先前往 <a href="/part-names/new" className="text-blue-600 hover:underline" target="_blank">名称库</a> 新建</p>
          </div>

          {/* 品牌和规格 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">品牌</label>
              <div className="flex gap-2">
                <select className="flex-1 px-3 py-2 border border-gray-300 rounded-lg" value={form.brand_id} onChange={(e) => setForm({ ...form, brand_id: e.target.value })}>
                  <option value="">请选择</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <button type="button" onClick={handleCreateBrand} className="px-3 py-2 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 whitespace-nowrap">+ 新建</button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">规格</label>
              <div className="flex gap-2">
                <select className="flex-1 px-3 py-2 border border-gray-300 rounded-lg" value={form.specification_id} onChange={(e) => setForm({ ...form, specification_id: e.target.value, specification_text: "" })}>
                  <option value="">从库选择</option>
                  {specifications.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <button type="button" onClick={handleCreateSpec} className="px-3 py-2 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 whitespace-nowrap">+ 新建</button>
              </div>
              {!form.specification_id && (
                <input className="w-full mt-2 px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="或直接输入规格" value={form.specification_text} onChange={(e) => setForm({ ...form, specification_text: e.target.value })} />
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">配件编号 *</label>
              <input required className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={form.part_number} onChange={(e) => setForm({ ...form, part_number: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">初始库存</label>
              <input type="number" className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">最低库存预警</label>
              <input type="number" className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">成本价</label>
              <input type="number" className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">销售价</label>
              <input type="number" className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">存放位置</label>
              <input className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <textarea rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>

          {/* 图片上传占位 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">配件图片</label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center text-gray-400">
              <p>图片上传功能开发中（支持上传、粘贴、拍照）</p>
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
