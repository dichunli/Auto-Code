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
      className={`text-sm text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg px-4 py-2 disabled:opacity-50 ${className}`}
    >
      {deleting ? "删除中..." : "删除课程"}
    </button>
  );
}
