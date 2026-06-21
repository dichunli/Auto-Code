"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient, 确保有session } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import AssignByGroupModal from "./AssignByGroupModal";

interface 员工 {
  id: string;
  full_name: string;
  group_id?: string | null;
}

interface 分组 {
  id: string;
  name: string;
  description: string | null;
  memberIds: string[];
}

export default function AssignCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [courseId, setCourseId] = useState("");
  const [employees, setEmployees] = useState<员工[]>([]);
  const [groups, setGroups] = useState<分组[]>([]);
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);

  useEffect(() => {
    params.then((p) => setCourseId(p.id));

    async function loadData() {
      const [{ data: profilesData }, { data: groupsData }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, group_id").eq("is_active", true).order("full_name"),
        supabase.from("employee_groups").select("id, name, description, sort_order").order("sort_order"),
      ]);

      const loadedEmployees: 员工[] = (profilesData || []).map((p) => ({
        id: String(p.id),
        full_name: String(p.full_name || ""),
        group_id: p.group_id ? String(p.group_id) : null,
      }));

      const groupMap = new Map<string, 分组>();
      (groupsData || []).forEach((g) => {
        groupMap.set(String(g.id), {
          id: String(g.id),
          name: String(g.name || ""),
          description: g.description ? String(g.description) : null,
          memberIds: [],
        });
      });

      loadedEmployees.forEach((emp) => {
        if (emp.group_id && groupMap.has(emp.group_id)) {
          groupMap.get(emp.group_id)!.memberIds.push(emp.id);
        }
      });

      setEmployees(loadedEmployees);
      setGroups([...groupMap.values()]);
    }

    loadData();
  }, [params, supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedEmployees.length === 0) {
      alert("请至少选择一位学员");
      return;
    }
    setLoading(true);

    try {
      await 确保有session();

      const records = selectedEmployees.map((empId) => ({
        course_id: courseId,
        employee_id: empId,
        due_date: dueDate || null,
      }));

      const { error } = await supabase.from("training_assignments").insert(records);
      if (error) throw error;

      router.push(`/training/${courseId}`);
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "未知错误";
      alert("分配失败: " + msg);
      setLoading(false);
    }
  }

  function toggleEmployee(id: string) {
    setSelectedEmployees((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  const selectedNames = useMemo(() => {
    const map = new Map(employees.map((e) => [e.id, e.full_name]));
    return selectedEmployees.map((id) => map.get(id) || "").filter(Boolean);
  }, [employees, selectedEmployees]);

  return (
    <div>
      <PageHeader title="分配课程" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-700">选择学员</label>
            <button
              type="button"
              onClick={() => setGroupModalOpen(true)}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
            >
              按组选择
            </button>
          </div>

          {selectedEmployees.length > 0 && (
            <div className="mb-2 text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
              已选 {selectedEmployees.length} 人
              {selectedNames.length > 0 && (
                <span className="ml-1 text-gray-500">（{selectedNames.slice(0, 5).join("、")}
                  {selectedNames.length > 5 && ` 等${selectedNames.length}人`}）
                </span>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-3">
            {employees.map((emp) => (
              <label key={emp.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedEmployees.includes(emp.id)}
                  onChange={() => toggleEmployee(emp.id)}
                  className="rounded"
                />
                <span>{emp.full_name}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">截止日期</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>

        <div className="flex gap-3 justify-end pt-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "保存中..." : "确认分配"}
          </button>
        </div>
      </form>

      <AssignByGroupModal
        open={groupModalOpen}
        onClose={() => setGroupModalOpen(false)}
        groups={groups}
        employees={employees}
        selectedEmployees={selectedEmployees}
        onChangeSelected={setSelectedEmployees}
      />
    </div>
  );
}
