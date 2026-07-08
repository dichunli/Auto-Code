"use client";

import {useState, useEffect, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export default function SettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from("system_settings")
        .select("value")
        .eq("key", "supervisor_code")
        .single();
      if (data) setCode(data.value);
      setLoading(false);
    }
    load();
  }, [supabase]);

  async function handleSave() {
    if (!code.trim()) {
      alert("授权码不能为空");
      return;
    }
    if (!/^\d{4,8}$/.test(code.trim())) {
      alert("授权码必须是 4~8 位数字");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("system_settings")
      .update({ value: code.trim(), updated_at: new Date().toISOString() })
      .eq("key", "supervisor_code");
    setSaving(false);
    if (error) {
      alert("保存失败: " + error.message);
    } else {
      alert("保存成功");
    }
  }

  return (
    <div>
      <PageHeader title="系统设置" description="管理系统参数" />

      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-lg space-y-6">
        {/* 个人信息入口 */}
        <div className="flex items-center justify-between pb-5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">个人信息</h2>
            <p className="text-sm text-gray-500 mt-1">
              修改头像、联系方式和登录密码
            </p>
          </div>
          <a
            href="/profile"
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
          >
            前往设置
            <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </a>
        </div>

        {/* 搜索分词词典入口 */}
        <div className="flex items-center justify-between pb-5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">搜索分词词典</h2>
            <p className="text-sm text-gray-500 mt-1">
              管理知识库搜索的中文分词词库
            </p>
          </div>
          <a
            href="/settings/segment-dictionary"
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
          >
            前往设置
            <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </a>
        </div>

        {/* 语义搜索同义词入口 */}
        <div className="flex items-center justify-between pb-5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">语义搜索同义词</h2>
            <p className="text-sm text-gray-500 mt-1">
              管理语义搜索的同义词扩展，搜"刹车"自动关联"制动"
            </p>
          </div>
          <a
            href="/settings/synonyms"
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
          >
            前往设置
            <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </a>
        </div>

        {/* 文章向量生成入口 */}
        <div className="flex items-center justify-between pb-5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">文章向量生成</h2>
            <p className="text-sm text-gray-500 mt-1">
              批量为旧文章生成语义搜索向量，生成后才能被语义搜索匹配
            </p>
          </div>
          <a
            href="/settings/embeddings"
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
          >
            前往设置
            <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </a>
        </div>

        <div>
          <h2 className="text-base font-semibold text-gray-900 mb-4">重复开单授权码</h2>
          <p className="text-sm text-gray-500 mb-4">
            当同一车牌已有未完成工单时，输入此授权码可继续开单。
          </p>
          <div className="flex gap-3">
            <input
              type="text"
              inputMode="numeric"
              placeholder="请输入授权码"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              maxLength={8}
              disabled={loading}
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={loading || saving}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
          {loading && <p className="text-xs text-gray-400 mt-2">加载中...</p>}
        </div>
      </div>
    </div>
  );
}
