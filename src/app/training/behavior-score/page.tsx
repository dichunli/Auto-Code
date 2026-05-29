"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

interface 员工 {
  id: string;
  full_name: string;
}

interface 行为项目 {
  id: string;
  name: string;
  score_type: string;
  score_value: number;
}

interface 打分记录 {
  id: string;
  employee_name: string;
  item_name: string;
  score_type: string;
  score: number;
  notes: string | null;
  scored_at: string;
}

export default function BehaviorScorePage() {
  const supabase = createClient();
  const [employees, setEmployees] = useState<员工[]>([]);
  const [items, setItems] = useState<行为项目[]>([]);
  const [records, setRecords] = useState<打分记录[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  /* 表单 */
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [selectedItem, setSelectedItem] = useState("");
  const [actualScore, setActualScore] = useState("");
  const [notes, setNotes] = useState("");

  async function fetchData() {
    setLoading(true);
    const [{ data: empData }, { data: itemData }] = await Promise.all([
      supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
      supabase.from("behavior_score_items").select("id, name, score_type, score_value").eq("is_active", true).order("name"),
    ]);
    setEmployees((empData as 员工[] | null) || []);
    setItems((itemData as 行为项目[] | null) || []);

    /* 加载最近 30 条打分记录 */
    const { data: recordData } = await supabase
      .from("behavior_score_records")
      .select("id, score, notes, scored_at, profiles!behavior_score_records_employee_id_fkey(full_name), behavior_score_items(name, score_type)")
      .order("scored_at", { ascending: false })
      .limit(30);

    setRecords(
      (recordData || []).map((r: unknown) => {
        const rec = r as {
          id: string;
          score: number;
          notes: string | null;
          scored_at: string;
          profiles: { full_name: string }[] | { full_name: string } | null;
          behavior_score_items: { name: string; score_type: string }[] | { name: string; score_type: string } | null;
        };
        const profile = Array.isArray(rec.profiles) ? rec.profiles[0] : rec.profiles;
        const item = Array.isArray(rec.behavior_score_items) ? rec.behavior_score_items[0] : rec.behavior_score_items;
        return {
          id: rec.id,
          employee_name: profile?.full_name || "",
          item_name: item?.name || "",
          score_type: item?.score_type || "",
          score: rec.score,
          notes: rec.notes,
          scored_at: rec.scored_at,
        };
      })
    );

    setLoading(false);
  }

  useEffect(() => {
    fetchData();
  }, [supabase]);

  /* 选择项目后自动填充默认分值 */
  useEffect(() => {
    if (selectedItem) {
      const item = items.find((i) => i.id === selectedItem);
      if (item) {
        setActualScore(String(item.score_value));
      }
    }
  }, [selectedItem, items]);

  async function handleSubmit() {
    if (!selectedEmployee) {
      alert("请选择员工");
      return;
    }
    if (!selectedItem) {
      alert("请选择评分项目");
      return;
    }
    if (!actualScore || parseInt(actualScore) <= 0) {
      alert("请输入有效分数");
      return;
    }

    setSaving(true);
    try {
      const item = items.find((i) => i.id === selectedItem);
      const finalScore = item?.score_type === "penalty" ? -Math.abs(parseInt(actualScore)) : Math.abs(parseInt(actualScore));

      const { error } = await supabase.from("behavior_score_records").insert({
        employee_id: selectedEmployee,
        item_id: selectedItem,
        score: finalScore,
        notes: notes.trim() || null,
      });

      if (error) throw error;

      /* 重置表单 */
      setSelectedEmployee("");
      setSelectedItem("");
      setActualScore("");
      setNotes("");

      fetchData();
      alert("打分成功");
    } catch (err: unknown) {
      alert("保存失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="行为规范打分" description="对员工进行日常行为考核打分" />

      {/* 打分表单 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
        <h3 className="text-base font-semibold text-gray-900 mb-4">新增打分</h3>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">员工 *</label>
              <select
                value={selectedEmployee}
                onChange={(e) => setSelectedEmployee(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">请选择</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">评分项目 *</label>
              <select
                value={selectedItem}
                onChange={(e) => setSelectedItem(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">请选择</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.score_type === "bonus" ? "+" : "-"}
                    {i.score_value})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">实际分数 *</label>
              <input
                type="number"
                value={actualScore}
                onChange={(e) => setActualScore(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder="默认取项目分值，可修改"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder="打分原因..."
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "保存中..." : "确认打分"}
            </button>
          </div>
        </div>
      </div>

      {/* 历史记录 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-4">最近打分记录</h3>
        {loading ? (
          <div className="text-center text-gray-400 py-8">加载中...</div>
        ) : records.length === 0 ? (
          <div className="text-center text-gray-400 py-8">暂无记录</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">时间</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">员工</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">项目</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">分数</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">备注</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(r.scored_at).toLocaleDateString("zh-CN")}
                    </td>
                    <td className="px-4 py-3">{r.employee_name}</td>
                    <td className="px-4 py-3">{r.item_name}</td>
                    <td className="px-4 py-3">
                      <span className={r.score > 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                        {r.score > 0 ? "+" : ""}
                        {r.score}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{r.notes || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
