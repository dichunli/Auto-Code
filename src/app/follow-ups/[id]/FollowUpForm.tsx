"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const METHOD_OPTIONS = [
  { value: "phone", label: "电话" },
  { value: "sms", label: "短信" },
  { value: "wechat", label: "微信" },
];

export function FollowUpForm({ followUpId }: { followUpId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [method, setMethod] = useState("phone");
  const [result, setResult] = useState("");
  const [notes, setNotes] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!result.trim()) {
      alert("请填写回访结果");
      return;
    }

    setLoading(true);
    const { error } = await supabase
      .from("follow_ups")
      .update({
        completed_at: new Date().toISOString(),
        method,
        result: result.trim(),
        notes: notes.trim() || null,
      })
      .eq("id", followUpId);

    if (error) {
      alert("保存失败: " + error.message);
      setLoading(false);
      return;
    }

    router.push("/follow-ups");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 border-t border-gray-100 pt-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">回访方式 *</label>
        <div className="flex gap-3">
          {METHOD_OPTIONS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMethod(m.value)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                method === m.value
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">回访结果 *</label>
        <textarea
          required
          rows={3}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="例如：客户对维修效果满意，表示下次保养还会来"
          value={result}
          onChange={(e) => setResult(e.target.value)}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
        <textarea
          rows={2}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="可选，记录下次保养建议、投诉内容等"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={loading}
          className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {loading ? "保存中..." : "确认完成回访"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/follow-ups")}
          className="px-5 py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
        >
          取消
        </button>
      </div>
    </form>
  );
}
