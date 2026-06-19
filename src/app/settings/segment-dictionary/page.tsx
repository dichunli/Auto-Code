"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { 中文分词 } from "@/lib/chineseSegmenter";

export default function SegmentDictionaryPage() {
  const supabase = useMemo(() => createClient(), []);
  const [words, setWords] = useState<string[]>([]);
  const [newWord, setNewWord] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [previewInput, setPreviewInput] = useState("捷达A5点烟器保险位置");

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
        admin = (roleData || []).some(
          (d: { roles?: { name?: string } | null }) => d.roles?.name === "admin"
        );
      }
      setIsAdmin(admin);

      /* 读取自定义分词 */
      const { data } = await supabase
        .from("search_dictionary")
        .select("word")
        .order("created_at", { ascending: false });
      setWords((data || []).map((row) => String(row.word)));

      setLoading(false);
    }
    load();
  }, [supabase]);

  async function handleAdd() {
    const word = newWord.trim();
    if (!word) {
      alert("请输入要添加的分词");
      return;
    }
    if (words.includes(word)) {
      alert("该分词已存在");
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("search_dictionary").insert({ word });
    setSaving(false);

    if (error) {
      alert("添加失败: " + error.message);
      return;
    }

    setWords((prev) => [word, ...prev]);
    setNewWord("");
  }

  async function handleDelete(word: string) {
    if (!confirm(`确定要删除分词「${word}」吗？`)) return;

    setSaving(true);
    const { error } = await supabase.from("search_dictionary").delete().eq("word", word);
    setSaving(false);

    if (error) {
      alert("删除失败: " + error.message);
      return;
    }

    setWords((prev) => prev.filter((w) => w !== word));
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
        <PageHeader title="搜索分词词典" description="管理知识库搜索的自定义分词" />
        <div className="p-12 text-center text-gray-400">加载中...</div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="搜索分词词典" description="管理知识库搜索的自定义分词" />
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          只有管理员可以访问此页面
        </div>
      </div>
    );
  }

  const previewResult = 中文分词(previewInput, words);

  return (
    <div>
      <PageHeader title="搜索分词词典" description="管理知识库搜索的自定义分词" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 添加和列表 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
          <div>
            <h2 className="text-base font-semibold text-gray-900 mb-2">添加分词</h2>
            <p className="text-sm text-gray-500 mb-4">
              添加后，知识库搜索会自动把连续输入按这里的词拆分。
            </p>
            <div className="flex gap-3">
              <input
                type="text"
                value={newWord}
                onChange={(e) => setNewWord(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="例如：涡轮增压器、点火线圈"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={saving}
              />
              <button
                type="button"
                onClick={handleAdd}
                disabled={saving || !newWord.trim()}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "添加中..." : "添加"}
              </button>
            </div>
          </div>

          <div>
            <h2 className="text-base font-semibold text-gray-900 mb-3">已添加的分词（{words.length} 个）</h2>
            {words.length === 0 ? (
              <p className="text-sm text-gray-400 py-4">暂无自定义分词</p>
            ) : (
              <div className="flex flex-wrap gap-2 max-h-96 overflow-y-auto">
                {words.map((word) => (
                  <div
                    key={word}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-sm"
                  >
                    <span>{word}</span>
                    <button
                      type="button"
                      onClick={() => handleDelete(word)}
                      disabled={saving}
                      className="ml-1 text-blue-400 hover:text-blue-600 disabled:opacity-50"
                      title="删除"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 分词预览 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-base font-semibold text-gray-900">分词效果预览</h2>
          <p className="text-sm text-gray-500">
            输入一句话，查看当前默认词库 + 自定义词库的分词结果。
          </p>
          <input
            type="text"
            value={previewInput}
            onChange={(e) => setPreviewInput(e.target.value)}
            placeholder="输入要测试的搜索词..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
            <p className="text-xs text-gray-500 mb-2">分词结果：</p>
            <div className="flex flex-wrap gap-2">
              {previewResult.length === 0 ? (
                <span className="text-sm text-gray-400">无结果</span>
              ) : (
                previewResult.map((word, index) => (
                  <span
                    key={`${word}-${index}`}
                    className="px-2 py-1 bg-white border border-gray-200 rounded text-sm text-gray-700"
                  >
                    {word}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
