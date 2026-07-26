"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

interface 同义词记录 {
  id: string;
  term: string;
  synonyms: string[];
}

export default function SynonymsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [synonyms, setSynonyms] = useState<同义词记录[]>([]);
  const [term, setTerm] = useState("");
  const [synonymInput, setSynonymInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);

      /* 检查管理员权限 */
      const { data: userData } = await supabase.auth.getUser();
      const currentUserId = userData.user?.id || "";
      let admin = false;
      if (currentUserId) {
        const { data: roleData } = await supabase
          .from("profile_roles")
          .select("roles(name)")
          .eq("profile_id", currentUserId);
        admin = ((roleData || []) as unknown as { roles?: { name?: string } | null }[]).some(
          (d) => d.roles?.name === "admin"
        );
      }
      setIsAdmin(admin);

      /* 读取同义词列表 */
      const { data } = await supabase
        .from("synonym_mapping")
        .select("id, term, synonyms")
        .order("created_at", { ascending: false });
      setSynonyms(
        (data || []).map((row) => ({
          id: String(row.id),
          term: String(row.term),
          synonyms: Array.isArray(row.synonyms) ? (row.synonyms as string[]) : [],
        }))
      );

      setLoading(false);
    }
    load();
  }, [supabase]);

  async function handleAdd() {
    const 原词 = term.trim();
    const 同义词组 = synonymInput
      .split(/[,，、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (!原词) {
      alert("请输入原词");
      return;
    }
    if (同义词组.length === 0) {
      alert("请输入至少一个同义词（用逗号分隔）");
      return;
    }

    /* 编辑模式 */
    if (editingId) {
      /* 检查是否与其他记录重名 */
      if (synonyms.some((s) => s.id !== editingId && s.term === 原词)) {
        alert(`原词「${原词}」已存在，请勿重复`);
        return;
      }

      setSaving(true);
      const { error } = await supabase
        .from("synonym_mapping")
        .update({ term: 原词, synonyms: 同义词组, updated_at: new Date().toISOString() })
        .eq("id", editingId);
      setSaving(false);

      if (error) {
        alert("更新失败: " + error.message);
        return;
      }

      setSynonyms((prev) =>
        prev.map((s) =>
          s.id === editingId ? { ...s, term: 原词, synonyms: 同义词组 } : s
        )
      );
      handleCancelEdit();
      return;
    }

    /* 新增模式 */
    if (synonyms.some((s) => s.term === 原词)) {
      alert(`原词「${原词}」已存在，请勿重复添加`);
      return;
    }

    setSaving(true);
    const { data, error } = await supabase
      .from("synonym_mapping")
      .insert({ term: 原词, synonyms: 同义词组 })
      .select("id, term, synonyms")
      .single();
    setSaving(false);

    if (error) {
      alert("添加失败: " + error.message);
      return;
    }

    if (data) {
      setSynonyms((prev) => [
        {
          id: String(data.id),
          term: String(data.term),
          synonyms: Array.isArray(data.synonyms) ? (data.synonyms as string[]) : [],
        },
        ...prev,
      ]);
    }
    setTerm("");
    setSynonymInput("");
  }

  function handleEdit(item: 同义词记录) {
    setEditingId(item.id);
    setTerm(item.term);
    setSynonymInput(item.synonyms.join("、"));
  }

  function handleCancelEdit() {
    setEditingId(null);
    setTerm("");
    setSynonymInput("");
  }

  async function handleDelete(id: string, term: string) {
    if (!confirm(`确定要删除「${term}」的同义词映射吗？`)) return;

    setSaving(true);
    const { error } = await supabase.from("synonym_mapping").delete().eq("id", id);
    setSaving(false);

    if (error) {
      alert("删除失败: " + error.message);
      return;
    }

    setSynonyms((prev) => prev.filter((s) => s.id !== id));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="同义词管理" description="管理语义搜索的同义词扩展" />
        <div className="p-12 text-center text-gray-400">加载中...</div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="同义词管理" description="管理语义搜索的同义词扩展" />
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          只有管理员可以访问此页面
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="同义词管理" description="管理语义搜索的同义词扩展。搜原词时，自动用同义词扩展搜索范围。" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 添加和列表 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
          <div>
            <h2 className="text-base font-semibold text-gray-900 mb-2">
              {editingId ? "编辑同义词" : "添加同义词"}
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              {editingId
                ? "修改原词或同义词，保存后立即生效。"
                : "用户搜索「原词」时，自动把「同义词」加入搜索范围，提高命中率。"}
            </p>

            <div className="space-y-3">
              {/* 原词 */}
              <div>
                <label className="block text-sm text-gray-600 mb-1">原词</label>
                <input
                  type="text"
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="例如：刹车"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={saving}
                />
              </div>

              {/* 同义词 */}
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  同义词（用逗号分隔）
                </label>
                <input
                  type="text"
                  value={synonymInput}
                  onChange={(e) => setSynonymInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="例如：制动、制动系统、刹车片"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={saving}
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={saving || !term.trim() || !synonymInput.trim()}
                  className="flex-1 px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "保存中..." : editingId ? "保存修改" : "添加"}
                </button>
                {editingId && (
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    disabled={saving}
                    className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                  >
                    取消
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">
              已配置的同义词（{synonyms.length} 组）
            </h2>
            <p className="text-xs text-gray-400 mb-3">
              搜索时命中原词会自动扩展到同义词
            </p>

            {/* 搜索过滤 */}
            <div className="relative mb-3">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="搜索原词或同义词..."
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {filterText && (
                <button
                  type="button"
                  onClick={() => setFilterText("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  ×
                </button>
              )}
            </div>

            {(() => {
              const 过滤后 = filterText.trim()
                ? synonyms.filter(
                    (s) =>
                      s.term.includes(filterText.trim()) ||
                      s.synonyms.some((syn) => syn.includes(filterText.trim()))
                  )
                : synonyms;

            return (
              <>
            {过滤后.length === 0 ? (
              <p className="text-sm text-gray-400 py-4">
                {filterText.trim() ? "没有匹配的同义词" : "暂无同义词配置，请手动添加或执行 SQL 迁移文件导入预置数据"}
              </p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {过滤后.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 bg-gray-50 rounded-lg border border-gray-100"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-sm font-medium">
                            {item.term}
                          </span>
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                        <div className="flex flex-wrap gap-1.5 ml-1">
                          {item.synonyms.map((syn) => (
                            <span
                              key={syn}
                              className="px-2 py-0.5 bg-green-50 text-green-600 border border-green-200 rounded text-xs"
                            >
                              {syn}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => handleEdit(item)}
                          disabled={saving}
                          className="text-sm text-blue-400 hover:text-blue-600 transition-colors p-1"
                          title="编辑"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(item.id, item.term)}
                          disabled={saving}
                          className="text-sm text-red-400 hover:text-red-600 transition-colors p-1"
                          title="删除"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        );
      })()}
          </div>
        </div>

        {/* 使用说明 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4 self-start">
          <h2 className="text-base font-semibold text-gray-900">使用说明</h2>

          <div className="space-y-4">
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
              <h3 className="text-sm font-medium text-blue-800 mb-2">工作原理</h3>
              <p className="text-sm text-blue-600">
                用户搜索时，系统先查同义词表。如果搜索词包含「原词」，自动把所有「同义词」加入搜索范围，提高语义搜索的命中率。
              </p>
            </div>

            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">示例</h3>
              <div className="bg-gray-50 rounded-lg p-3 space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <span className="font-medium text-gray-500 min-w-[60px]">配置：</span>
                  <span>
                    <code className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-xs mr-1">刹车</code>
                    → 制动、制动系统、刹车片
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-medium text-gray-500 min-w-[60px]">效果：</span>
                  <span className="text-gray-600">
                    搜&ldquo;刹车异响&rdquo; → 自动扩展为搜索&ldquo;刹车异响 + 制动 + 制动系统 + 刹车片&rdquo;
                  </span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">建议</h3>
              <ul className="text-sm text-gray-500 space-y-1.5 list-disc list-inside">
                <li>原词用最常用的说法（如&ldquo;刹车&rdquo;而不是&ldquo;制动&rdquo;）</li>
                <li>同义词列全各种叫法（俗称、学名、别名）</li>
                <li>不要设太多同义词（每词 2~5 个最佳）</li>
                <li>添加后立即生效，无需重启</li>
              </ul>
            </div>

            <div className="p-3 bg-amber-50 rounded-lg border border-amber-100">
              <h3 className="text-sm font-medium text-amber-800 mb-1">当前生效的同义词</h3>
              <div className="text-sm text-amber-600">
                共 <span className="font-semibold">{synonyms.length}</span> 组，
                覆盖{" "}
                <span className="font-semibold">
                  {synonyms.reduce((sum, s) => sum + s.synonyms.length, 0)}
                </span>{" "}
                个扩展词
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
