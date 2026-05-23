"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export default function SettingsPage() {
  const supabase = createClient();
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
