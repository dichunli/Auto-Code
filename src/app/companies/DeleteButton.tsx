"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Props {
  id: string;
}

export function DeleteButton({ id }: Props) {
  const supabase = createClient();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm("确定要删除该单位吗？删除前会检查关联数据。")) return;
    setDeleting(true);

    // 检查关联客户
    const { count: customerCount } = await supabase
      .from("customers")
      .select("*", { count: "exact", head: true })
      .eq("company_id", id);
    if (customerCount && customerCount > 0) {
      alert(`无法删除：该单位下还有 ${customerCount} 个客户，请先处理。`);
      setDeleting(false);
      return;
    }

    const { error } = await supabase.from("companies").delete().eq("id", id);
    if (error) {
      alert("删除失败: " + error.message);
    } else {
      window.location.reload();
    }
    setDeleting(false);
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
    >
      {deleting ? "删除中..." : "删除"}
    </button>
  );
}
