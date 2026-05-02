"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export default function NewPartSpecificationPage() {
  const router = useRouter();
  const supabase = createClient();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");

  const search = useCallback(
    async (q: string) => {
      if (!q.trim()) { setResults([]); return; }
      setSearching(true);
      const { data } = await supabase.from("part_specifications").select("id, name").ilike("name", `%${q.trim()}%`).order("name").limit(20);
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
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { alert("请输入规格名称"); return; }
    setLoading(true);

    const { error } = await supabase.from("part_specifications").insert({ name: name.trim() });
    if (error) {
      alert("保存失败: " + error.message);
      setLoading(false);
      return;
    }

    router.push("/part-specifications");
    router.refresh();
  }

  return (
    <div>
      <PageHeader title="新建配件规格" />
      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
        {!showForm && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">搜索规格名称</label>
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
                    <div className="text-sm text-red-600 font-medium">该规格已存在，不允许新建相同规格</div>
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
                    <div className="text-sm text-gray-500">未找到包含「{query.trim()}」的规格。</div>
                    <button
                      type="button"
                      onClick={handleStartCreate}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                    >
                      新建规格「{query.trim()}」
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
              <label className="block text-sm font-medium text-gray-700 mb-1">规格名称 *</label>
              <input
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="如：5W-30 1L、D1109"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="mt-8 flex gap-3 justify-end">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">返回搜索</button>
              <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">{loading ? "保存中..." : "保存"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
