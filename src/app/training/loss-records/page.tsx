"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

interface 员工 {
  id: string;
  full_name: string;
}

interface 损失记录 {
  id: string;
  employee_name: string;
  loss_type: string;
  description: string;
  loss_amount: number;
  recorded_at: string;
}

const 损失类型选项 = ["工具损坏", "材料浪费", "操作失误", "设备损坏", "其他"];

export default function LossRecordsPage() {
  const supabase = createClient();
  const [employees, setEmployees] = useState<员工[]>([]);
  const [records, setRecords] = useState<损失记录[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  /* 表单 */
  const [form, setForm] = useState({
    employee_id: "",
    loss_type: "工具损坏",
    description: "",
    loss_amount: "",
  });

  async function fetchData() {
    setLoading(true);
    const [{ data: empData }, { data: recordData }] = await Promise.all([
      supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
      supabase
        .from("daily_loss_records")
        .select("id, loss_type, description, loss_amount, recorded_at, profiles!daily_loss_records_employee_id_fkey(full_name)")
        .order("recorded_at", { ascending: false })
        .limit(50),
    ]);

    setEmployees((empData as 员工[] | null) || []);

    setRecords(
      (recordData || []).map((r: unknown) => {
        const rec = r as {
          id: string;
          loss_type: string;
          description: string;
          loss_amount: number;
          recorded_at: string;
          profiles: { full_name: string }[] | { full_name: string } | null;
        };
        const profile = Array.isArray(rec.profiles) ? rec.profiles[0] : rec.profiles;
        return {
          id: rec.id,
          employee_name: profile?.full_name || "",
          loss_type: rec.loss_type,
          description: rec.description,
          loss_amount: rec.loss_amount,
          recorded_at: rec.recorded_at,
        };
      })
    );

    setLoading(false);
  }

  useEffect(() => {
    fetchData();
  }, [supabase]);

  async function handleSave() {
    if (!form.employee_id) {
      alert("请选择责任人");
      return;
    }
    if (!form.description.trim()) {
      alert("请输入损失描述");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from("daily_loss_records").insert({
        employee_id: form.employee_id,
        loss_type: form.loss_type,
        description: form.description.trim(),
        loss_amount: form.loss_amount ? parseFloat(form.loss_amount) : 0,
      });

      if (error) throw error;

      setModalOpen(false);
      setForm({ employee_id: "", loss_type: "工具损坏", description: "", loss_amount: "" });
      fetchData();
      alert("记录成功");
    } catch (err: unknown) {
      alert("保存失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("确定删除这条损失记录吗？")) return;
    const { error } = await supabase.from("daily_loss_records").delete().eq("id", id);
    if (error) {
      alert("删除失败: " + error.message);
      return;
    }
    fetchData();
  }

  return (
    <div>
      <PageHeader
        title="日常损失记录"
        description="记录员工造成的日常损失"
        action={{ label: "+ 新增记录", onClick: () => setModalOpen(true) }}
      />

      {loading ? (
        <div className="p-8 text-center text-gray-400">加载中...</div>
      ) : records.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500">暂无损失记录</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">日期</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">责任人</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">损失类型</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">描述</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">损失金额</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {records.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(r.recorded_at).toLocaleDateString("zh-CN")}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">{r.employee_name}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{r.loss_type}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-700 max-w-xs truncate">{r.description}</td>
                  <td className="px-4 py-3 text-red-600">
                    {r.loss_amount > 0 ? `¥${r.loss_amount.toFixed(2)}` : "-"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(r.id)}
                      className="text-xs px-2 py-1 text-red-600 hover:bg-red-50 rounded border border-red-200"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 弹窗 */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md">
            <h3 className="text-base font-semibold text-gray-900 mb-4">新增损失记录</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">责任人 *</label>
                <select
                  value={form.employee_id}
                  onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="">请选择</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>{e.full_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">损失类型</label>
                <select
                  value={form.loss_type}
                  onChange={(e) => setForm({ ...form, loss_type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  {损失类型选项.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">损失描述 *</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="描述损失情况..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">损失金额</label>
                <input
                  type="number"
                  value={form.loss_amount}
                  onChange={(e) => setForm({ ...form, loss_amount: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-4 mt-4 border-t border-gray-100">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
