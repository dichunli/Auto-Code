"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/utils";

const CHECK_TYPES = [
  { key: "appearance", label: "仪容仪表" },
  { key: "venue", label: "场地规范" },
  { key: "tools", label: "工具摆放" },
  { key: "other", label: "其他" },
];

export default function BehaviorChecksPage() {
  const supabase = createClient();
  const [checks, setChecks] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    check_type: "appearance",
    employee_id: "",
    score: "0",
    notes: "",
  });

  useEffect(() => {
    fetchChecks();
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name").then(({ data }) => {
      setEmployees(data || []);
    });
  }, [supabase]);

  async function fetchChecks() {
    const { data } = await supabase
      .from("behavior_checks")
      .select("*, employee:profiles!behavior_checks_employee_id_fkey(full_name), checker:profiles!behavior_checks_checker_id_fkey(full_name)")
      .order("checked_at", { ascending: false })
      .limit(100);
    setChecks((data || []) as any);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.from("behavior_checks").insert({
        check_type: form.check_type,
        employee_id: form.employee_id,
        score: parseInt(form.score) || 0,
        notes: form.notes || null,
      });
      if (error) throw error;
      setShowForm(false);
      setForm({ check_type: "appearance", employee_id: "", score: "0", notes: "" });
      fetchChecks();
    } catch (err: any) {
      alert("保存失败: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader title="行为检查记录" description="员工日常行为规范检查与扣分" />

      <div className="mb-4">
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          {showForm ? "取消" : "+ 新建检查记录"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-5 max-w-xl mb-6 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">检查类型</label>
              <select value={form.check_type} onChange={(e) => setForm({ ...form, check_type: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                {CHECK_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">员工</label>
              <select required value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">请选择</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.full_name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">得分（负数为扣分）</label>
            <input type="number" value={form.score} onChange={(e) => setForm({ ...form, score: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">备注</label>
            <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div className="flex gap-3 justify-end">
            <button type="submit" disabled={loading} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {loading ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">类型</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">员工</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">得分</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">备注</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">检查人</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {checks.map((c: any) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">{CHECK_TYPES.find((t) => t.key === c.check_type)?.label || c.check_type}</td>
                  <td className="px-4 py-3">{c.employee?.full_name}</td>
                  <td className={`px-4 py-3 font-medium ${c.score >= 0 ? "text-green-600" : "text-red-600"}`}>{c.score > 0 ? `+${c.score}` : c.score}</td>
                  <td className="px-4 py-3 text-gray-500">{c.notes || "-"}</td>
                  <td className="px-4 py-3 text-gray-500">{c.checker?.full_name || "-"}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(c.checked_at)}</td>
                </tr>
              ))}
              {checks.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">暂无记录</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
