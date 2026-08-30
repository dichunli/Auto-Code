import { createClient } from "@/lib/supabase/server";
import SynonymsContent, { type 同义词记录 } from "./SynonymsContent";

/* 同义词管理 — Server Component
 * 首屏同义词列表和管理员身份在服务端查询，避免 SPA 软导航时客户端 session 未就绪导致空白 */

export default async function SynonymsPage() {
  const supabase = await createClient();

  /* 检查管理员权限（与原客户端逻辑一致） */
  const { data: userData } = await supabase.auth.getUser();
  const currentUserId = userData.user?.id || "";
  let isAdmin = false;
  if (currentUserId) {
    const { data: roleData } = await supabase
      .from("profile_roles")
      .select("roles(name)")
      .eq("profile_id", currentUserId);
    isAdmin = ((roleData || []) as unknown as { roles?: { name?: string } | null }[]).some(
      (d) => d.roles?.name === "admin"
    );
  }

  /* 读取同义词列表 */
  const { data } = await supabase
    .from("synonym_mapping")
    .select("id, term, synonyms")
    .order("created_at", { ascending: false });

  const initialSynonyms: 同义词记录[] = (data || []).map((row) => ({
    id: String(row.id),
    term: String(row.term),
    synonyms: Array.isArray(row.synonyms) ? (row.synonyms as string[]) : [],
  }));

  return <SynonymsContent initialSynonyms={initialSynonyms} initialIsAdmin={isAdmin} />;
}
