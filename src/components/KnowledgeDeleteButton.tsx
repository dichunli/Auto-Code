"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Props {
  articleId: string;
}

export function KnowledgeDeleteButton({ articleId }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [deleting, setDeleting] = useState(false);
  const [canDelete, setCanDelete] = useState(false);

  /* 检查删除权限 */
  useEffect(() => {
    async function checkPermission() {
      const { data: userData } = await supabase.auth.getUser();
      const currentUserId = userData?.user?.id;
      if (!currentUserId) return;

      /* 获取文章创建者 */
      const { data: article } = await supabase
        .from("knowledge_articles")
        .select("created_by")
        .eq("id", articleId)
        .single();

      const isOwner = article?.created_by === currentUserId;

      /* 检查是否是管理员 */
      const { data: roleData } = await supabase
        .from("profile_roles")
        .select("roles(name)")
        .eq("profile_id", currentUserId);

      const roleNames = (roleData || []).map(
        (d: { roles?: { name?: string } | null }) => d.roles?.name
      ).filter(Boolean) as string[];
      const isAdmin = roleNames.includes("admin");

      setCanDelete(isAdmin || isOwner);
    }
    checkPermission();
  }, [articleId, supabase]);

  async function handleDelete() {
    if (!confirm("确定要删除这篇文章吗？删除后不可恢复。")) return;
    setDeleting(true);

    try {
      /* 先删除关联数据 */
      await supabase.from("knowledge_service_links").delete().eq("article_id", articleId);
      await supabase.from("knowledge_vehicle_links").delete().eq("article_id", articleId);

      /* 再删除文章 */
      const { error } = await supabase.from("knowledge_articles").delete().eq("id", articleId);
      if (error) throw error;

      router.push("/knowledge");
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      alert("删除失败: " + message);
      setDeleting(false);
    }
  }

  if (!canDelete) return null;

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      className="text-sm px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors disabled:opacity-50"
    >
      {deleting ? "删除中..." : "删除"}
    </button>
  );
}
