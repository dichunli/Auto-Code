"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/utils";

export default function BehaviorTasksPage() {
  const supabase = createClient();
  const [tasks, setTasks] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    assignee_id: "",
    score_reward: "5",
  });

  useEffect(() => {
    fetchTasks();
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name").then(({ data }) => {
      setEmployees(data || []);
    });
  }, [supabase]);

  async function fetchTasks() {
    const { data } = await supabase
      .from("behavior_tasks")
      .select("*, assignee:profiles!behavior_tasks_assignee_id_fkey(full_name), assigned_by_profile:profiles!behavior_tasks_assigned_by_fkey(full_name)")
      .order("created_at", { ascending: false })
      .limit(100);
    setTasks((data || []) as any);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.from("behavior_tasks").insert({
        title: form.title,
        description: form.description || null,
        assignee_id: form.assignee_id,
        score_reward: parseInt(form.score_reward) || 0,
      });
      if (error) throw error;
      setShowForm(false);
      setForm({ title: "", description: "", assignee_id: "", score_reward: "5" });
      fetchTasks();
    } catch (err: any) {
      alert("保存失败: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function completeTask(taskId: string) {
    const { error } = await supabase
      .from("behavior_tasks")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", taskId);
    if (error) {
      alert("操作失败: " + error.message);
      return;
    }
    fetchTasks();
  }

  return (
    <div>
      <PageHeader title="行为任务分派" description="分派任务给员工，完成后加分" />

      <div className="mb-4">
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          {showForm ? "取消" : "+ 新建任务"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-5 max-w-xl mb-6 space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">任务标题 *</label>
            <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">任务描述</label>
            <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">指派给 *</label>
              <select required value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">请选择</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">奖励分数</label>
              <input type="number" value={form.score_reward} onChange={(e) => setForm({ ...form, score_reward: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
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
                <th className="px-4 py-3 text-left font-medium text-gray-500">任务</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">指派给</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">奖励</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tasks.map((t: any) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{t.title}</div>
                    {t.description && <div className="text-xs text-gray-500">{t.description}</div>}
                  </td>
                  <td className="px-4 py-3">{t.assignee?.full_name}</td>
                  <td className="px-4 py-3 text-green-600 font-medium">+{t.score_reward}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      t.status === "completed" ? "bg-green-50 text-green-700" : "bg-yellow-50 text-yellow-700"
                    }`}>
                      {t.status === "completed" ? "已完成" : "待完成"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {t.status === "pending" && (
                      <button
                        type="button"
                        onClick={() => completeTask(t.id)}
                        className="text-xs px-2 py-1 rounded bg-green-50 text-green-600 hover:bg-green-100 border border-green-200"
                      >
                        确认完成
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">暂无任务</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
