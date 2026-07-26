"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { 删除学员分配 } from "./actions";

interface 删除学员按钮属性 {
  assignmentId: string;
  学员姓名: string;
}

export default function DeleteAssignmentButton({ assignmentId, 学员姓名 }: 删除学员按钮属性) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm(`确定要移除学员「${学员姓名}」吗？移除后将同时删除该学员的学习进度、考试答题和成绩记录。`)) return;
    setDeleting(true);

    const result = await 删除学员分配(assignmentId);
    setDeleting(false);

    if (!result.success) {
      alert("移除失败: " + (result.error || "未知错误"));
      return;
    }

    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      title="移除学员"
      className="text-red-500 hover:text-red-700 hover:bg-red-50 rounded p-1 disabled:opacity-50 transition-colors"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    </button>
  );
}
