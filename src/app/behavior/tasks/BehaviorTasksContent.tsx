"use client";

import {useState, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { useConfirm } from "@/components/ConfirmDialog";

interface 行为项目 {
  id: string;
  name: string;
  score_type: string;
  score_value: number;
  responsible_id: string | null;
  checker_id: string | null;
}

interface 员工 {
  id: string;
  full_name: string;
}

interface 考核任务 {
  id: string;
  name: string;
  item_id: string;
  item_name: string;
  item_score: number;
  item_score_type: string;
  frequency: string;
  execute_time: string;
  end_time: string;
  execute_weekday: number;
  execute_day: number;
  employee_ids: string[];
  is_active: boolean;
}

export default function BehaviorTasksContent({
  initialItems,
  initialEmployees,
  initialTasks,
}: {
  initialItems: 行为项目[];
  initialEmployees: 员工[];
  initialTasks: 考核任务[];
}) {
  const supabase = useMemo(() => createClient(), []);
  /* 首屏数据由服务端传入；loading 仅用于增删改后的客户端重查 */
  const [items, setItems] = useState<行为项目[]>(initialItems);
  const [employees, setEmployees] = useState<员工[]>(initialEmployees);
  const [tasks, setTasks] = useState<考核任务[]>(initialTasks);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<考核任务 | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const { 请求确认, 确认弹窗 } = useConfirm();

  const [form, setForm] = useState({
    name: "",
    item_id: "",
    frequency: "daily",
    execute_time: "09:00",
    end_time: "23:59",
    execute_weekday: "1",
    execute_day: "1",
    employee_ids: [] as string[],
    is_active: true,
  });

  async function fetchData() {
    setLoading(true);
    const [{ data: itemData }, { data: empData }, { data: taskData }] = await Promise.all([
      supabase.from("behavior_score_items").select("id, name, score_type, score_value, responsible_id, checker_id").eq("is_active", true).order("name"),
      supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
      supabase.from("behavior_check_tasks").select("*").order("created_at", { ascending: false }),
    ]);

    setItems((itemData as 行为项目[] | null) || []);
    setEmployees((empData as 员工[] | null) || []);

    const itemMap = new Map((itemData as 行为项目[] | null)?.map((i) => [i.id, i]) || []);

    setTasks(
      ((taskData || []) as 考核任务[]).map((t) => {
        const item = itemMap.get(t.item_id);
        return {
          ...t,
          item_name: item?.name || "",
          item_score: item?.score_value || 0,
          item_score_type: item?.score_type || "bonus",
          employee_ids: t.employee_ids || [],
        };
      })
    );
    setLoading(false);
  }

  function openAdd() {
    setEditingTask(null);
    setForm({
      name: "",
      item_id: "",
      frequency: "daily",
      execute_time: "09:00",
      end_time: "23:59",
      execute_weekday: "1",
      execute_day: "1",
      employee_ids: [],
      is_active: true,
    });
    setModalOpen(true);
  }

  function openEdit(task: 考核任务) {
    setEditingTask(task);
    setForm({
      name: task.name,
      item_id: task.item_id,
      frequency: task.frequency,
      execute_time: task.execute_time?.slice(0, 5) || "09:00",
      end_time: task.end_time?.slice(0, 5) || "23:59",
      execute_weekday: String(task.execute_weekday || 1),
      execute_day: String(task.execute_day || 1),
      employee_ids: task.employee_ids || [],
      is_active: task.is_active,
    });
    setModalOpen(true);
  }

  function toggleEmployee(empId: string) {
    setForm((prev) => {
      const exists = prev.employee_ids.includes(empId);
      if (exists) {
        return { ...prev, employee_ids: prev.employee_ids.filter((id) => id !== empId) };
      }
      return { ...prev, employee_ids: [...prev.employee_ids, empId] };
    });
  }

  async function handleSave() {
    if (!form.name.trim()) {
      alert("请输入任务名称");
      return;
    }
    if (!form.item_id) {
      alert("请选择关联的行为项目");
      return;
    }
    if (form.end_time <= form.execute_time) {
      alert("结束时间必须晚于开始时间");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        item_id: form.item_id,
        frequency: form.frequency,
        execute_time: form.execute_time + ":00",
        end_time: form.end_time + ":00",
        execute_weekday: form.frequency === "weekly" ? parseInt(form.execute_weekday) : null,
        execute_day: form.frequency === "monthly" ? parseInt(form.execute_day) : null,
        employee_ids: form.employee_ids.length > 0 ? form.employee_ids : null,
        is_active: form.is_active,
      };

      if (editingTask) {
        const { error } = await supabase.from("behavior_check_tasks").update(payload).eq("id", editingTask.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("behavior_check_tasks").insert(payload);
        if (error) throw error;
      }

      setModalOpen(false);
      fetchData();
    } catch (err: unknown) {
      alert("保存失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!(await 请求确认("确定删除这条考核任务吗？"))) return;
    const { error } = await supabase.from("behavior_check_tasks").delete().eq("id", id);
    if (error) {
      alert("删除失败: " + error.message);
      return;
    }
    fetchData();
  }

  const frequencyLabels: Record<string, string> = {
    daily: "每日",
    weekly: "每周",
    monthly: "每月",
  };

  const weekdayLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  /* 员工 id → 姓名，用于"责任人制"提示行 */
  const employeeMap = useMemo(() => new Map(employees.map((e) => [e.id, e.full_name])), [employees]);
  /* 当前表单选中的项目 */
  const selectedItem = useMemo(() => items.find((i) => i.id === form.item_id) || null, [items, form.item_id]);

  return (
    <div>
      <PageHeader
        title="行为考核任务"
        description="配置定时行为考核任务，在检查时间段内完成检查，超时自动关闭"
        action={{ label: "+ 添加任务", onClick: openAdd }}
      />

      {loading ? (
        <div className="p-8 text-center text-gray-400">加载中...</div>
      ) : tasks.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500">暂无考核任务</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">任务名称</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">关联项目</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">频率</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">检查时间段</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">考核对象</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tasks.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{t.name}</td>
                  <td className="px-4 py-3">
                    {t.item_name}
                    <span className={`text-xs ml-1 ${t.item_score_type === "bonus" ? "text-green-600" : "text-red-600"}`}>
                      ({t.item_score_type === "bonus" ? "+" : "-"}{t.item_score})
                    </span>
                  </td>
                  <td className="px-4 py-3">{frequencyLabels[t.frequency]}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {t.execute_time?.slice(0, 5)} ~ {(t.end_time || "23:59").slice(0, 5)}
                    {t.frequency === "weekly" && `（${weekdayLabels[t.execute_weekday || 0]}）`}
                    {t.frequency === "monthly" && `（${t.execute_day}号）`}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {t.employee_ids && t.employee_ids.length > 0 ? `${t.employee_ids.length} 人` : "全员"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        t.is_active
                          ? "bg-blue-50 text-blue-700 border border-blue-200"
                          : "bg-gray-50 text-gray-500 border border-gray-200"
                      }`}
                    >
                      {t.is_active ? "启用" : "停用"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEdit(t)}
                      className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-50 rounded border border-blue-200 mr-2"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleDelete(t.id)}
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
          <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-semibold text-gray-900 mb-4">
              {editingTask ? "编辑任务" : "添加任务"}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">任务名称 *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="如：早会卫生检查"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">关联行为项目 *</label>
                <select
                  value={form.item_id}
                  onChange={(e) => setForm({ ...form, item_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="">请选择</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} ({i.score_type === "bonus" ? "+" : "-"}{i.score_value})
                    </option>
                  ))}
                </select>
                {/* 责任人制项目：考核对象由项目配置决定，下方多选不生效 */}
                {selectedItem?.responsible_id && (
                  <p className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 mt-2">
                    该项目为责任人制：被考核人={employeeMap.get(selectedItem.responsible_id) || "?"}，
                    检查人={selectedItem.checker_id ? employeeMap.get(selectedItem.checker_id) || "?" : "责任人自检"}。
                    下方"考核对象"设置对本任务不生效。
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">频率</label>
                  <select
                    value={form.frequency}
                    onChange={(e) => setForm({ ...form, frequency: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="daily">每日</option>
                    <option value="weekly">每周</option>
                    <option value="monthly">每月</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">检查时间段</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="time"
                      value={form.execute_time}
                      onChange={(e) => setForm({ ...form, execute_time: e.target.value })}
                      className="flex-1 px-2 py-2 border border-gray-300 rounded-lg text-sm"
                      title="开始时间"
                    />
                    <span className="text-gray-400 text-sm">至</span>
                    <input
                      type="time"
                      value={form.end_time}
                      onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                      className="flex-1 px-2 py-2 border border-gray-300 rounded-lg text-sm"
                      title="结束时间（超过则关闭检查）"
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">超过结束时间自动关闭检查（漏检不扣分）</p>
                </div>
              </div>

              {form.frequency === "weekly" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">周几执行</label>
                  <select
                    value={form.execute_weekday}
                    onChange={(e) => setForm({ ...form, execute_weekday: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    {weekdayLabels.map((label, index) => (
                      <option key={index} value={index}>{label}</option>
                    ))}
                  </select>
                </div>
              )}

              {form.frequency === "monthly" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">几号执行</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={form.execute_day}
                    onChange={(e) => setForm({ ...form, execute_day: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              )}

              {/* 考核对象 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">考核对象（仅对未设责任人的项目生效，不选=全员，可拖动排序）</label>
                <div className="border border-gray-200 rounded-lg p-2 space-y-1">
                  {employees.map((e) => (
                    <label
                      key={e.id}
                      draggable
                      onDragStart={() => setDragId(e.id)}
                      onDragOver={(ev) => {
                        ev.preventDefault();
                        if (dragId && dragId !== e.id) setDragOverId(e.id);
                      }}
                      onDrop={(ev) => {
                        ev.preventDefault();
                        if (!dragId || dragId === e.id) {
                          setDragId(null);
                          setDragOverId(null);
                          return;
                        }
                        const fromIndex = employees.findIndex((emp) => emp.id === dragId);
                        const toIndex = employees.findIndex((emp) => emp.id === e.id);
                        if (fromIndex === -1 || toIndex === -1) {
                          setDragId(null);
                          setDragOverId(null);
                          return;
                        }
                        const next = [...employees];
                        const [moved] = next.splice(fromIndex, 1);
                        next.splice(toIndex, 0, moved);
                        setEmployees(next);
                        setDragId(null);
                        setDragOverId(null);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDragOverId(null);
                      }}
                      className={`flex items-center gap-2 p-1.5 hover:bg-gray-50 rounded cursor-move ${
                        dragOverId === e.id ? "bg-blue-50 border border-blue-200" : ""
                      } ${dragId === e.id ? "opacity-50" : ""}`}
                    >
                      <svg className="w-3 h-3 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                      </svg>
                      <input
                        type="checkbox"
                        checked={form.employee_ids.includes(e.id)}
                        onChange={() => toggleEmployee(e.id)}
                        className="rounded"
                      />
                      <span className="text-sm text-gray-700">{e.full_name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_active_task"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="rounded"
                />
                <label htmlFor="is_active_task" className="text-sm text-gray-700">启用</label>
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
      {确认弹窗}
    </div>
  );
}
