"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { 压缩图片 } from "@/lib/imageCompress";

interface 知识文章 {
  id: string;
  title: string;
}

interface 工具 {
  id: string;
  code: string;
  location: string | null;
}

export default function NewToolPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [保存中, set保存中] = useState(false);
  const [图片上传中, set图片上传中] = useState(false);
  const [加载中, set加载中] = useState(true);

  const [表单, set表单] = useState({
    code: "",
    name: "",
    instructions: "",
    knowledge_article_id: "",
    location: "",
    status: "available",
  });

  const [图片地址, set图片地址] = useState("");
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

  /* 加载已有工具：生成编码、收集存放位置 */
  useEffect(() => {
    async function 初始化() {
      set加载中(true);
      try {
        const { data } = await supabase.from("tools").select("code, location").order("created_at", { ascending: false });
        const tools = (data as 工具[]) || [];

        /* 自动生成编码：取 GJ-xxx 最大序号 +1 */
        let maxNum = 0;
        tools.forEach((t) => {
          const match = t.code?.match(/^GJ-(\d+)$/i);
          if (match) {
            maxNum = Math.max(maxNum, parseInt(match[1], 10));
          }
        });
        const nextCode = `GJ-${String(maxNum + 1).padStart(3, "0")}`;

        /* 收集已有存放位置 */
        const locations = Array.from(
          new Set(tools.map((t) => t.location).filter((loc): loc is string => !!loc))
        ).sort();

        set表单((prev) => ({ ...prev, code: nextCode }));
        set位置列表(locations);
      } finally {
        set加载中(false);
      }
    }
    初始化();
  }, [supabase]);

  async function 上传图片(file: File) {
    if (!file.type.startsWith("image/")) {
      alert("请选择图片文件");
      return;
    }
    set图片上传中(true);
    try {
      const compressed = await 压缩图片(file);
      const formData = new FormData();
      formData.append("file", compressed, file.name);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "上传失败");
      set图片地址(result.path);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("图片上传失败: " + msg);
    } finally {
      set图片上传中(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = 表单.code.trim();
    const name = 表单.name.trim();
    if (!code || !name) {
      alert("请填写工具编码和名称");
      return;
    }

    const finalLocation = 使用新位置 ? 新位置.trim() : 表单.location.trim();

    set保存中(true);
    try {
      /* 检查编码唯一性 */
      const { data: 重复 } = await supabase
        .from("tools")
        .select("id")
        .ilike("code", code)
        .maybeSingle();
      if (重复) {
        alert("工具编码已存在，请更换");
        set保存中(false);
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: 插入结果, error } = await supabase
        .from("tools")
        .insert({
          code,
          name,
          image_url: 图片地址 || null,
          instructions: 表单.instructions.trim() || null,
          knowledge_article_id: 表单.knowledge_article_id || null,
          location: finalLocation || null,
          status: 表单.status,
          created_by: user?.id || null,
        })
        .select("id")
        .single();

      if (error || !插入结果) {
        alert("保存失败: " + (error?.message || "未知错误"));
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
        <PageHeader title="新建工具" />
        <div className="text-sm text-gray-500 py-8">加载中...</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="新建工具" />
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl space-y-5"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              工具编码 *
            </label>
            <input
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="如：GJ-001"
              value={表单.code}
              onChange={(e) => set表单({ ...表单, code: e.target.value })}
            />
            <p className="text-xs text-gray-400 mt-1">已自动生成，可手动修改</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              工具名称 *
            </label>
            <input
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="如：扭矩扳手"
              value={表单.name}
              onChange={(e) => set表单({ ...表单, name: e.target.value })}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">存放位置</label>
          {!使用新位置 ? (
            <div className="flex gap-2">
              <select
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="px-3 py-2 text-sm text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-50"
              >
                + 新增位置
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                选已有位置
              </button>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">工具图片</label>
          <div className="flex items-center gap-3">
            {图片地址 ? (
              <div className="relative w-20 h-20 rounded-lg border border-gray-200 overflow-hidden">
                <img src={图片地址} alt="工具图片" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => set图片地址("")}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center"
                >
                  ×
                </button>
              </div>
            ) : null}
            <label className="px-4 py-2 text-sm font-medium text-blue-600 bg-white border border-blue-300 rounded-lg hover:bg-blue-50 cursor-pointer disabled:opacity-50">
              {图片上传中 ? "上传中..." : "上传图片"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={图片上传中}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) 上传图片(file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <p className="text-xs text-gray-400 mt-1">支持 jpg/png/webp，会自动压缩至 300KB 以内</p>
        </div>

        <div className="relative">
          <label className="block text-sm font-medium text-gray-700 mb-1">使用说明</label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="关联知识库文章..."
            value={知识搜索}
            onChange={(e) => {
              set知识搜索(e.target.value);
              set显示知识下拉(true);
            }}
            onFocus={() => set显示知识下拉(true)}
          />
          {表单.knowledge_article_id && (
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xs text-gray-600">已选择：{知识结果.find((k) => k.id === 表单.knowledge_article_id)?.title || "已选择文章"}</span>
              <button
                type="button"
                onClick={() => {
                  set表单({ ...表单, knowledge_article_id: "" });
                  set知识搜索("");
                }}
                className="text-xs text-red-600 hover:text-red-800"
              >
                清除
              </button>
            </div>
          )}
          {显示知识下拉 && (知识搜索.trim() || 知识结果.length > 0) && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
              {知识搜索中 ? (
                <div className="px-4 py-2 text-sm text-gray-500">搜索中...</div>
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
                    className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50"
                  >
                    {k.title}
                  </button>
                ))
              ) : (
                <div className="px-4 py-2 text-sm text-gray-500">未找到匹配文章</div>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">补充说明</label>
          <textarea
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="填写工具的补充说明、注意事项等"
            value={表单.instructions}
            onChange={(e) => set表单({ ...表单, instructions: e.target.value })}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">初始状态</label>
          <select
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={表单.status}
            onChange={(e) => set表单({ ...表单, status: e.target.value })}
          >
            <option value="available">在库</option>
            <option value="borrowed">借出</option>
            <option value="scrapped">报废</option>
          </select>
        </div>

        <div className="flex gap-3 justify-end pt-4">
          <button
            type="button"
            onClick={() => router.push("/tools/management")}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={保存中 || 图片上传中}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {保存中 ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}
