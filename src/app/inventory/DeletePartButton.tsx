"use client";

import { useState } from "react";
import { deletePart } from "@/app/parts/actions";
import { useRouter } from "next/navigation";

export default function DeletePartButton({ partId }: { partId: string }) {
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    if (!confirm("确定要删除这个配件吗？此操作不可恢复。")) return;
    setDeleting(true);
    const result = await deletePart(partId);
    if (result.success) {
      router.refresh();
    } else {
      alert(result.error || "删除失败");
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
