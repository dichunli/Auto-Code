"use client";

import {useState, useEffect, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

interface 员工 {
  id: string;
  full_name: string;
}

interface 返工记录 {
  id: string;
  employee_name: string;
  work_order_no: string | null;
  description: string;
  loss_amount: number;
  recorded_at: string;
}

export default function ReworkRecordsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [employees, setEmployees] = useState<员工[]>([]);
  const [records, setRecords] = useState<返工记录[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  /* 表单 */
  const [form, setForm] = useState({
    employee_id: "",
    work_order_no: "",
    description: "",
    loss_amount: "",
  });

  async function fetchData() {
    setLoading(true);
    const [{ data: empData }, { data: recordData }] = await Promise.all([
      supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
      supabase
        .from("rework_records")
        .select("id, description, loss_amount, recorded_at, profiles!rework_records_employee_id_fkey(full_name), work_orders!rework_records_work_order_id_fkey(order_no)")
        .order("recorded_at", { ascending: false })
        .limit(50),
    ]);

    setEmployees((empData as 员工[] | null) || []);

    setRecords(
      (recordData || []).map((r: unknown) => {
        const rec = r as {
          id: string;
          description: string;
          loss_amount: number;
          recorded_at: string;
          profiles: { full_name: string }[] | { full_name: string } | null;
          work_orders: { order_no: string }[] | { order_no: string } | null;
        };
        const profile = Array.isArray(rec.profiles) ? rec.profiles[0] : rec.profiles;
        const wo = Array.isArray(rec.work_orders) ? rec.work_orders[0] : rec.work_orders;
        return {
          id: rec.id,
          employee_name: profile?.full_name || "",
          work_order_no: wo?.order_no || null,
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
      alert("请输入返工原因");
      return;
    }

    setSaving(true);
    try {
      /* 查找工单ID（如果输入了工单号） */
      let workOrderId = null;
      if (form.work_order_no.trim()) {
        const { data: wo } = await supabase
          .from("work_orders")
          .select("id")
          .eq("order_no", form.work_order_no.trim())
          .single();
        if (wo) workOrderId = wo.id;
      }

      const { error } = await supabase.from("rework_records").insert({
        employee_id: form.employee_id,
        work_order_id: workOrderId,
        description: form.description.trim(),
        loss_amount: form.loss_amount ? parseFloat(form.loss_amount) : 0,
      });

      if (error) throw error;

      setModalOpen(false);
      setForm({ employee_id: "", work_order_no: "", description: "", loss_amount: "" });
      fetchData();
      alert("记录成功");
    } catch (err: unknown) {
      alert("保存失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("确定删除这条返工记录吗？")) return;
    const { error } = await supabase.from("rework_records").delete().eq("id", id);
    if (error) {
      alert("删除失败: " + error.message);
      return;
    }
    fetchData();
  }

  return (
    <div>
      <PageHeader
        title="返工记录"
        description="记录员工造成的返工及损失"
        action={{ label: "+ 新增记录", onClick: () => setModalOpen(true) }}
      />

      {loading ? (
        <div className="p-8 text-center text-gray-400">加载中...</div>
      ) : records.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500">暂无返工记录</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">日期</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">责任人</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">关联工单</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">返工原因</th>
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
                  <td className="px-4 py-3 text-gray-500">{r.work_order_no || "-"}</td>
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
            <h3 className="text-base font-semibold text-gray-900 mb-4">新增返工记录</h3>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">关联工单号</label>
                <input
                  value={form.work_order_no}
                  onChange={(e) => setForm({ ...form, work_order_no: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="输入工单号（选填）"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">返工原因 *</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="描述返工原因..."
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
