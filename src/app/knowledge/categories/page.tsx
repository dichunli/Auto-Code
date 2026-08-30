import { createClient } from "@/lib/supabase/server";
import KnowledgeCategoriesContent, { type 分类 } from "./KnowledgeCategoriesContent";

/* 知识库分类管理 — Server Component
 * 首屏分类列表在服务端查询，避免 SPA 软导航时客户端 session 未就绪导致空白 */

export default async function KnowledgeCategoriesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("knowledge_categories")
    .select("id, name, sort_order")
    .order("sort_order", { ascending: true })
    .limit(100);

  return <KnowledgeCategoriesContent initialCategories={(data || []) as 分类[]} />;
}
