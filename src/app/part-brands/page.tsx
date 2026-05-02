"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { DeleteButton } from "./DeleteButton";

export default function PartBrandsPage() {
  const supabase = createClient();
  const [query, setQuery] = useState("");
  const [brands, setBrands] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [pnQuery, setPnQuery] = useState("");
  const [pnResults, setPnResults] = useState<any[]>([]);
  const [pnSearching, setPnSearching] = useState(false);
  const [linkedNames, setLinkedNames] = useState<{ id: string; name: string; category_name?: string }[]>([]);

  const loadBrands = useCallback(
    async (search?: string) => {
      setSearching(!!search);
      let q = supabase
        .from("part_brands")
        .select("*, part_name_brands(part_names(id, name, part_categories(name)))")
        .order("usage_count", { ascending: false });
      if (search?.trim()) {
        q = q.ilike("name", `%${search.trim()}%`);
      }
      const { data } = await q;
      setBrands(data || []);
      setLoading(false);
      setSearching(false);
    },
    [supabase]
  );

  useEffect(() => {
    loadBrands();
  }, [loadBrands]);

  useEffect(() => {
    const t = setTimeout(() => loadBrands(query), 300);
    return () => clearTimeout(t);
  }, [query, loadBrands]);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!pnQuery.trim()) {
        setPnResults([]);
        return;
      }
      setPnSearching(true);
      const { data } = await supabase
        .from("part_names")
        .select("id, name, part_categories(name)")
        .ilike("name", `%${pnQuery.trim()}%`)
        .order("name")
        .limit(10);
      setPnResults(data || []);
      setPnSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [pnQuery, supabase]);

  function handleStartCreate() {
    setName(query.trim());
    setShowForm(true);
  }

  function addLinkedName(pn: any) {
    if (linkedNames.some((n) => n.id === pn.id)) return;
    setLinkedNames((prev) => [
      ...prev,
      {
        id: pn.id,
        name: pn.name,
        category_name: pn.part_categories?.name,
      },
    ]);
    setPnQuery("");
    setPnResults([]);
  }

  function removeLinkedName(id: string) {
    setLinkedNames((prev) => prev.filter((n) => n.id !== id));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      alert("请输入品牌名称");
      return;
    }
    setSaving(true);

    const { data: brandData, error: brandError } = await supabase
      .from("part_brands")
      .insert({ name: name.trim() })
      .select("id")
      .single();

    if (brandError || !brandData) {
      alert("保存失败: " + (brandError?.message || "未知错误"));
      setSaving(false);
      return;
    }

    const brandId = brandData.id;
    if (linkedNames.length > 0) {
      const rows = linkedNames.map((n) => ({
        brand_id: brandId,
        part_name_id: n.id,
      }));
      const { error: linkError } = await supabase.from("part_name_brands").insert(rows);
      if (linkError) {
        alert("品牌创建成功，但关联配件名称失败: " + linkError.message);
        setSaving(false);
        return;
      }
    }

    setShowForm(false);
    setQuery("");
    setName("");
    setLinkedNames([]);
    setPnQuery("");
    setPnResults([]);
    loadBrands("");
    setSaving(false);
  }

  function formatLinkedNames(brand: any) {
    const list = brand.part_name_brands
      ?.map((bn: any) => bn.part_names?.name)
      .filter(Boolean);
    if (!list || list.length === 0) return "-";
    return list.join("、");
  }

  return (
    <div>
      <PageHeader title="配件品牌" description="管理配件品牌，使用频次越高排序越靠前" />

      <div className="mb-4 flex gap-2">
        <input
          className="w-1/4 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="搜索品牌名称..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query.trim() && (
          <button
            onClick={() => setQuery("")}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            清空
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">品牌名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">关联配件名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">使用频次</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {brands?.map((b: any) => (
                <tr key={b.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{b.name}</td>
                  <td className="px-6 py-4 text-gray-600 max-w-xs truncate">{formatLinkedNames(b)}</td>
                  <td className="px-6 py-4 text-gray-600">{b.usage_count || 0}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Link href={`/part-brands/${b.id}/edit`} className="text-sm text-blue-600 hover:text-blue-700 font-medium">编辑</Link>
                      <DeleteButton id={b.id} name={b.name} />
                    </div>
                  </td>
                </tr>
              ))}
              {(!brands || brands.length === 0) && !showForm && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center">
                    <div className="text-gray-400 mb-4">
                      {searching ? "搜索中..." : query.trim() ? "未找到匹配的品牌" : "暂无品牌"}
                    </div>
                    <button
                      onClick={handleStartCreate}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                    >
                      新建品牌
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="mt-6 bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
          <h2 className="text-base font-semibold text-gray-900 mb-4">新建配件品牌</h2>
          <form onSubmit={handleSubmit}>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">品牌名称 *</label>
              <input
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="如：博世、壳牌、曼牌"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="mt-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">关联配件名称（可选，可关联多个）</label>
              <div className="relative">
                <input
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="搜索配件名称并添加..."
                  value={pnQuery}
                  onChange={(e) => setPnQuery(e.target.value)}
                />
                {pnSearching && (
                  <div className="text-xs text-gray-400 mt-1">搜索中...</div>
                )}
                {pnResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {pnResults.map((pn) => (
                      <button
                        key={pn.id}
                        type="button"
                        onClick={() => addLinkedName(pn)}
                        disabled={linkedNames.some((n) => n.id === pn.id)}
                        className="w-full text-left px-4 py-2.5 hover:bg-gray-50 disabled:opacity-40 border-b border-gray-100 last:border-0"
                      >
                        <div className="text-sm text-gray-900">{pn.name}</div>
                        <div className="text-xs text-gray-400">{pn.part_categories?.name || "-"}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {linkedNames.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {linkedNames.map((n) => (
                    <span
                      key={n.id}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-md border border-blue-200"
                    >
                      {n.name}
                      <button
                        type="button"
                        onClick={() => removeLinkedName(n.id)}
                        className="text-blue-400 hover:text-blue-600">
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-8 flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setLinkedNames([]);
                  setPnQuery("");
                  setPnResults([]);
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
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
      )}
    </div>
  );
}
