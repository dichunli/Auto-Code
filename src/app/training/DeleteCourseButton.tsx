"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { 删除课程 } from "./actions";

interface 删除课程按钮属性 {
  id: string;
  title: string;
  onDeleted?: () => void;
  redirectTo?: string;
  className?: string;
}

export default function DeleteCourseButton({
  id,
  title,
  onDeleted,
  redirectTo,
  className = "",
}: 删除课程按钮属性) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm(`确定要删除课程「${title}」吗？删除后无法恢复。`)) return;
    setDeleting(true);

    const result = await 删除课程(id);
    setDeleting(false);

    if (!result.success) {
      alert("删除失败: " + (result.error || "未知错误"));
      return;
    }

    if (onDeleted) {
      onDeleted();
    } else if (redirectTo) {
      router.push(redirectTo);
    } else {
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      title="删除课程"
      className={`text-red-500 hover:text-red-700 hover:bg-red-50 rounded p-1 disabled:opacity-50 transition-colors ${className}`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    </button>
  );
}
