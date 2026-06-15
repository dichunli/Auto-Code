"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient, 确保有session } from "@/lib/supabase/client";

export default function DeleteButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm(`确定要删除分类「${name}」吗？`)) return;
    setDeleting(true);
    await 确保有session();

    const { data: courses, error: countError } = await supabase
      .from("training_courses")
      .select("id")
      .eq("category_id", id)
      .limit(1);

    if (countError) {
      alert("检查关联课程失败: " + countError.message);
      setDeleting(false);
      return;
    }

    if (courses && courses.length > 0) {
      alert("该分类下已有课程，无法删除。请先将课程移动到其他分类。");
      setDeleting(false);
      return;
    }

    const { error } = await supabase.from("training_categories").delete().eq("id", id);
    if (error) {
      alert("删除失败: " + error.message);
      setDeleting(false);
      return;
    }

    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      className="text-xs text-red-600 hover:text-red-800 hover:underline disabled:opacity-50"
    >
      {deleting ? "删除中..." : "删除"}
    </button>
  );
}
