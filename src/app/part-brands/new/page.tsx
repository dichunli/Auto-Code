"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";

export default function NewPartBrandPage() {
  const router = useRouter();
  const supabase = createClient();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [partNames, setPartNames] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const search = useCallback(
    async (q: string) => {
      if (!q.trim()) { setResults([]); return; }
      setSearching(true);
      const { data } = await supabase.from("part_brands").select("id, name").ilike("name", `%${q.trim()}%`).order("name").limit(20);
      setResults(data || []);
      setSearching(false);
    },
    [supabase]
  );

  async function handleSearch() {
    await search(query);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); handleSearch(); }
  }

  function handleStartCreate() {
    setName(query.trim());
    setShowForm(true);
    supabase.from("part_names").select("id, name, part_categories(name)").order("name").then(({ data }) => setPartNames(data || []));
  }

  function toggleId(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { alert("请输入品牌名称"); return; }
    setLoading(true);

    const { data: brandData, error: brandError } = await supabase
      .from("part_brands").insert({ name: name.trim() }).select("id").single();

    if (brandError || !brandData) {
      alert("保存失败: " + (brandError?.message || "未知错误"));
      setLoading(false);
      return;
    }

    const brandId = brandData.id;
    if (selectedIds.size > 0) {
      const rows = Array.from(selectedIds).map((partNameId) => ({ brand_id: brandId, part_name_id: partNameId }));
      const { error: linkError } = await supabase.from("part_name_brands").insert(rows);
      if (linkError) { alert("品牌创建成功，但关联配件名称失败: " + linkError.message); setLoading(false); return; }
    }

    router.push("/part-brands");
    router.refresh();
  }

  return (
    <div>
      <PageHeader title="新建配件品牌" />
      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
        {!showForm && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">搜索品牌名称</label>
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
                    <div className="text-sm text-red-600 font-medium">该品牌已存在，不允许新建相同品牌</div>
                    <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                      {results.map((r) => (
                        <div key={r.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                          <span className="text-sm text-gray-900">{r.name}</span>
                          <span className="text-sm text-gray-400">已存在</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-sm text-gray-500">未找到包含「{query.trim()}」的品牌。</div>
                    <button
                      type="button"
                      onClick={handleStartCreate}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                    >
                      新建品牌「{query.trim()}」
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {showForm && (
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
              <label className="block text-sm font-medium text-gray-700 mb-2">关联配件名称（可选）</label>
              <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto">
                {partNames.length === 0 && <div className="px-4 py-3 text-sm text-gray-400">暂无配件名称</div>}
                {partNames.map((pn) => (
                  <label key={pn.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-0">
                    <input type="checkbox" checked={selectedIds.has(pn.id)} onChange={() => toggleId(pn.id)} className="w-4 h-4 text-blue-600 rounded" />
                    <span className="text-sm text-gray-900">{pn.name}</span>
                    <span className="text-xs text-gray-400">{pn.part_categories?.name || "-"}</span>
                  </label>
                ))}
              </div>
              {selectedIds.size > 0 && <div className="mt-1 text-xs text-gray-500">已选择 {selectedIds.size} 项</div>}
            </div>

            <div className="mt-8 flex gap-3 justify-end">
              <button type="button" onClick={() => { setShowForm(false); setSelectedIds(new Set()); }} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">返回搜索</button>
              <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">{loading ? "保存中..." : "保存"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
