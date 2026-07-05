"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { ImageUploader } from "@/components/ImageUploader";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

interface 知识文章 {
  id: string;
  title: string;
}

export default function EditToolPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const supabase = useMemo(() => createClient(), []);
  const [加载中, set加载中] = useState(true);
  const [保存中, set保存中] = useState(false);
  const [表单, set表单] = useState({
    code: "",
    name: "",
    instructions: "",
    knowledge_article_id: "",
    location: "",
    status: "available",
  });

  const [图片地址, set图片地址] = useState<string[]>([]);
  const [知识搜索, set知识搜索] = useState("");
  const [知识结果, set知识结果] = useState<知识文章[]>([]);
  const [知识搜索中, set知识搜索中] = useState(false);
  const [显示知识下拉, set显示知识下拉] = useState(false);

  const [位置列表, set位置列表] = useState<string[]>([]);
  const [使用新位置, set使用新位置] = useState(false);
  const [新位置, set新位置] = useState("");

  const 搜索知识 = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        set知识结果([]);
        return;
      }
      set知识搜索中(true);
      const { data } = await supabase
        .from("knowledge_articles")
        .select("id, title")
        .ilike("title", `%${q.trim()}%`)
        .order("title")
        .limit(20);
      set知识结果((data as 知识文章[]) || []);
      set知识搜索中(false);
    },
    [supabase]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      搜索知识(知识搜索);
    }, 300);
    return () => clearTimeout(timer);
  }, [知识搜索, 搜索知识]);

  useEffect(() => {
    async function 加载() {
      try {
        const { data, error } = await supabase
          .from("tools")
          .select("*")
          .eq("id", id)
          .single();
        if (error || !data) {
          alert("工具不存在");
          router.push("/tools/management");
          return;
        }
        set表单({
          code: data.code || "",
          name: data.name || "",
          instructions: data.instructions || "",
          knowledge_article_id: data.knowledge_article_id || "",
          location: data.location || "",
          status: data.status || "available",
        });
        set图片地址(data.image_url ? data.image_url.split(",").filter(Boolean) : []);

        if (data.knowledge_article_id) {
          const { data: kData } = await supabase
            .from("knowledge_articles")
            .select("id, title")
            .eq("id", data.knowledge_article_id)
            .single();
          if (kData) {
            set知识搜索((kData as 知识文章).title);
          }
        }

        /* 加载已有存放位置 */
        const { data: locData } = await supabase
          .from("tools")
          .select("location")
          .neq("location", null);
        const locations = Array.from(
          new Set((locData || []).map((t: { location: string | null }) => t.location).filter(Boolean) as string[])
        ).sort();
        set位置列表(locations);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        alert("加载失败: " + msg);
      } finally {
        set加载中(false);
      }
    }
    加载();
  }, [id, supabase, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = 表单.code.trim();
    const name = 表单.name.trim();
    if (!code || !name) {
      alert("请填写工具编码和名称");
      return;
    }

    set保存中(true);
    try {
      const finalLocation = 使用新位置 ? 新位置.trim() : 表单.location.trim();

      /* 检查编码唯一性（排除自身） */
      const { data: 重复 } = await supabase
        .from("tools")
        .select("id")
        .ilike("code", code)
        .neq("id", id)
        .maybeSingle();
      if (重复) {
        alert("工具编码已存在，请更换");
        set保存中(false);
        return;
      }

      const { error } = await supabase
        .from("tools")
        .update({
          code,
          name,
          image_url: 图片地址.length > 0 ? 图片地址.join(",") : null,
          instructions: 表单.instructions.trim() || null,
          knowledge_article_id: 表单.knowledge_article_id || null,
          location: finalLocation || null,
          status: 表单.status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) {
        alert("保存失败: " + error.message);
        set保存中(false);
        return;
      }

      router.push("/tools/management");
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("保存异常: " + msg);
    } finally {
      set保存中(false);
    }
  }

  if (加载中) {
    return (
      <div>
        <PageHeader title="编辑工具" />
        <div className="text-sm text-gray-500 py-12 text-center">加载中...</div>
      </div>
    );
  }

  return (
    <div>
      {/* 桌面版头部 */}
      <div className="hidden sm:block">
        <PageHeader title="编辑工具" />
      </div>

      {/* 移动端头部 */}
      <div className="sm:hidden sticky top-0 z-30 bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => router.back()}
            className="w-9 h-9 -ml-2 rounded-lg flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-50"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-base font-semibold text-gray-900">编辑工具</h1>
          <div className="w-9"></div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="px-4 sm:px-0 pb-24">
        <div className="bg-white sm:rounded-xl sm:border sm:border-gray-200 sm:p-6 sm:max-w-2xl space-y-5">
          {/* 编码和名称 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                工具编码 <span className="text-red-500">*</span>
              </label>
              <input
                required
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={表单.code}
                onChange={(e) => set表单({ ...表单, code: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                工具名称 <span className="text-red-500">*</span>
              </label>
              <input
                required
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={表单.name}
                onChange={(e) => set表单({ ...表单, name: e.target.value })}
              />
            </div>
          </div>

          {/* 存放位置 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">存放位置</label>
            {!使用新位置 ? (
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
                  value={表单.location}
                  onChange={(e) => set表单({ ...表单, location: e.target.value })}
                >
                  <option value="">请选择存放位置</option>
                  {位置列表.map((loc) => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    set使用新位置(true);
                    set新位置("");
                  }}
                  className="px-4 py-2.5 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 bg-white"
                >
                  + 新增位置
                </button>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  placeholder="输入新的存放位置"
                  value={新位置}
                  onChange={(e) => set新位置(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => {
                    set使用新位置(false);
                    set新位置("");
                  }}
                  className="px-4 py-2.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 bg-white"
                >
                  选已有位置
                </button>
              </div>
            )}
          </div>

          {/* 工具图片 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">工具图片</label>
            <ImageUploader
              onUpload={(paths) => set图片地址((prev) => [...prev, ...paths])}
              onDelete={(path) => set图片地址((prev) => prev.filter((p) => p !== path))}
              existingImages={图片地址}
              maxImages={5}
            />
          </div>

          {/* 关联知识库 */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">关联知识库</label>
            <input
              type="text"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              placeholder="搜索知识库文章..."
              value={知识搜索}
              onChange={(e) => {
                set知识搜索(e.target.value);
                set显示知识下拉(true);
              }}
              onFocus={() => set显示知识下拉(true)}
            />
            {表单.knowledge_article_id && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-sm text-gray-600">已选择：{知识结果.find((k) => k.id === 表单.knowledge_article_id)?.title || "已选择文章"}</span>
                <button
                  type="button"
                  onClick={() => {
                    set表单({ ...表单, knowledge_article_id: "" });
                    set知识搜索("");
                  }}
                  className="text-sm text-red-500 hover:text-red-700"
                >
                  清除
                </button>
              </div>
            )}
            {显示知识下拉 && (知识搜索.trim() || 知识结果.length > 0) && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
                {知识搜索中 ? (
                  <div className="px-4 py-3 text-sm text-gray-400">搜索中...</div>
                ) : 知识结果.length > 0 ? (
                  知识结果.map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => {
                        set表单({ ...表单, knowledge_article_id: k.id });
                        set知识搜索(k.title);
                        set显示知识下拉(false);
                      }}
                      className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0"
                    >
                      {k.title}
                    </button>
                  ))
                ) : (
                  <div className="px-4 py-3 text-sm text-gray-400">未找到匹配文章</div>
                )}
              </div>
            )}
          </div>

          {/* 补充说明 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">补充说明</label>
            <textarea
              rows={4}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
              placeholder="填写工具的补充说明、注意事项等"
              value={表单.instructions}
              onChange={(e) => set表单({ ...表单, instructions: e.target.value })}
            />
          </div>

          {/* 状态 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">状态</label>
            <select
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
              value={表单.status}
              onChange={(e) => set表单({ ...表单, status: e.target.value })}
            >
              <option value="available">在库</option>
              <option value="borrowed">借出</option>
              <option value="scrapped">报废</option>
            </select>
          </div>
        </div>

        {/* 底部操作按钮 */}
        <div className="fixed sm:static bottom-0 left-0 right-0 bg-white sm:bg-transparent border-t sm:border-0 border-gray-200 px-4 sm:px-0 py-3 sm:py-4 sm:mt-0 sm:max-w-2xl">
          <div className="flex flex-row-reverse gap-3">
            <button
              type="submit"
              disabled={保存中}
              className="flex-1 sm:flex-none px-6 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {保存中 ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  保存中...
                </span>
              ) : (
                "保存"
              )}
            </button>
            <button
              type="button"
              onClick={() => router.push("/tools/management")}
              className="flex-1 sm:flex-none px-6 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              取消
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
