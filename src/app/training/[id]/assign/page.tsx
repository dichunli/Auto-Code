"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export default function AssignCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const supabase = createClient();
  const [courseId, setCourseId] = useState("");
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    params.then((p) => setCourseId(p.id));
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name").then(({ data }) => {
      setEmployees(data || []);
    });
  }, [params, supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedEmployees.length === 0) {
      alert("请至少选择一位学员");
      return;
    }
    setLoading(true);

    try {
      const records = selectedEmployees.map((empId) => ({
        course_id: courseId,
        employee_id: empId,
        due_date: dueDate || null,
      }));

      const { error } = await supabase.from("training_assignments").insert(records);
      if (error) throw error;

      router.push(`/training/${courseId}`);
      router.refresh();
    } catch (err: any) {
      alert("分配失败: " + err.message);
      setLoading(false);
    }
  }

  function toggleEmployee(id: string) {
    setSelectedEmployees((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  return (
    <div>
      <PageHeader title="分配课程" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">选择学员</label>
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
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>

        <div className="flex gap-3 justify-end pt-4">
          <button type="button" onClick={() => router.back()} className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
          <button type="submit" disabled={loading} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">{loading ? "保存中..." : "确认分配"}</button>
        </div>
      </form>
    </div>
  );
}
