"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export default function NewServiceItemPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [serviceNames, setServiceNames] = useState<any[]>([]);

  const [form, setForm] = useState({
    code: "",
    category_id: "",
    service_name_id: "",
    name: "",
    standard_hours: "",
    description: "",
    is_vehicle_specific: false,
    default_price: "",
  });

  useEffect(() => {
    supabase.from("service_categories").select("id, name").order("name").then(({ data }) => setCategories(data || []));
  }, [supabase]);

  useEffect(() => {
    if (form.category_id) {
      supabase.from("service_names").select("id, name").eq("category_id", form.category_id).order("name").then(({ data }) => setServiceNames(data || []));
    } else {
      setServiceNames([]);
    }
  }, [form.category_id, supabase]);

  // 选择名称库后自动填入项目名称
  useEffect(() => {
    if (form.service_name_id) {
      const selected = serviceNames.find((n) => n.id === form.service_name_id);
      if (selected && !form.name) {
        setForm((f) => ({ ...f, name: selected.name }));
      }
    }
  }, [form.service_name_id, serviceNames, form.name]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.from("service_items").insert({
      code: form.code || null,
      category_id: form.category_id || null,
      service_name_id: form.service_name_id || null,
      name: form.name,
      standard_hours: form.standard_hours ? parseFloat(form.standard_hours) : null,
      description: form.description || null,
      is_vehicle_specific: form.is_vehicle_specific,
      default_price: form.default_price ? parseFloat(form.default_price) : null,
    });

    if (error) {
      alert("保存失败: " + error.message);
      setLoading(false);
      return;
    }

    router.push("/service-items");
    router.refresh();
  }

  return (
    <div>
      <PageHeader title="新建维修项目" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">项目编码</label>
              <input className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="如：A001" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">所属分类 *</label>
              <select required className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value, service_name_id: "" })}>
                <option value="">请选择</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">关联名称库</label>
            <select className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={form.service_name_id} onChange={(e) => setForm({ ...form, service_name_id: e.target.value })}>
              <option value="">不关联（手动输入）</option>
              {serviceNames.map((n) => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">选择后自动填入项目名称</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">项目名称 *</label>
            <input required className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">标准工时</label>
              <input type="number" step="0.1" className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={form.standard_hours} onChange={(e) => setForm({ ...form, standard_hours: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">默认价格</label>
              <input type="number" className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={form.default_price} onChange={(e) => setForm({ ...form, default_price: e.target.value })} />
            </div>
            <div className="flex items-center pt-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_vehicle_specific} onChange={(e) => setForm({ ...form, is_vehicle_specific: e.target.checked })} className="w-4 h-4" />
                <span className="text-sm text-gray-700">按车型差异化定价</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">项目说明</label>
            <textarea rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
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
