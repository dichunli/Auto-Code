"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  employeeId: string;
  employeeName: string;
}

export function EmployeeDeleteButton({ employeeId, employeeName }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (!confirm(`确定要删除员工「${employeeName}」吗？\n\n该操作会同时删除其登录账号、联系人和角色配置，且不可恢复。\n如果该员工已离职，建议改为在编辑页将状态改为「离职」。`)) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/employees/${employeeId}`, { method: "DELETE" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "删除失败");
      alert("已删除");
      router.push("/employees");
      router.refresh();
    } catch (err: any) {
      alert("删除失败：" + (err instanceof Error ? err.message : String(err)));
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={loading}
      className="px-3 py-1.5 text-sm bg-red-50 text-red-600 rounded-lg border border-red-200 hover:bg-red-100 transition-colors disabled:opacity-50"
    >
      {loading ? "删除中..." : "删除"}
    </button>
  );
}
